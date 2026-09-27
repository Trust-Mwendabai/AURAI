"""
Model Arena — trains Prophet, ARIMA, Holt-Winters, XGBoost, LightGBM, and a
weighted Ensemble on the same series and backtest split so their accuracy can
be compared side-by-side. Runs as its own Flask service so a multi-model
comparison (slow — several fits in one request) never blocks the single-model
/api or /predict services used by the normal forecast flow.

Model fits run in parallel via a thread pool: each one spends most of its
time inside C/Fortran code (statsmodels, xgboost, lightgbm all release the
GIL during the heavy work), so threading gives a real wall-clock speedup
here rather than the usual Python-threading caveat.
"""
from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
import os
import contextlib
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from sklearn.metrics import mean_absolute_percentage_error

app = Flask(__name__)

FREQ_TO_PERIODS_PER_YEAR = {
    'H': 24 * 365, 'D': 365, 'W': 52, 'MS': 12, 'QS': 4, 'YS': 1,
}
FREQ_TO_PANDAS_STEP = {'H': 'h', 'D': 'D', 'W': 'W', 'MS': 'MS', 'QS': 'QS', 'YS': 'YS'}


def clean_and_prepare(ds_raw, y_raw):
    cleaned_ds = []
    for val in ds_raw:
        try:
            if isinstance(val, (pd.Timestamp, datetime)):
                cleaned_ds.append(val)
                continue
            val_str = str(val).strip()
            if val_str == '' or pd.isna(val):
                cleaned_ds.append(None)
                continue
            if val_str.isdigit() and len(val_str) == 4:
                cleaned_ds.append(datetime(int(val_str), 1, 1))
                continue
            parsed = pd.to_datetime(val_str, errors='coerce')
            cleaned_ds.append(parsed if not pd.isna(parsed) else None)
        except Exception:
            cleaned_ds.append(None)

    df = pd.DataFrame({'ds': cleaned_ds, 'y': y_raw})
    df = df.dropna(subset=['ds'])
    df['y'] = pd.to_numeric(df['y'], errors='coerce')
    df = df.dropna(subset=['y'])
    df = df.sort_values('ds').reset_index(drop=True)
    return df


def score(actual, predicted):
    """MAPE + accuracy for one model's predictions on the holdout."""
    pairs = [(a, p) for a, p in zip(actual, predicted) if a != 0 and not (pd.isna(p) if isinstance(p, float) else False)]
    if len(pairs) < 2:
        return None, None
    a_vals, p_vals = zip(*pairs)
    mape = round(mean_absolute_percentage_error(a_vals, p_vals) * 100, 2)
    accuracy = round(max(0.0, 100 - mape), 2)
    return accuracy, mape


def run_prophet(train_df, test_len, freq):
    from prophet import Prophet
    with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
        model = Prophet(uncertainty_samples=200)
        model.fit(train_df)
        future = model.make_future_dataframe(periods=test_len, freq=freq)
        forecast = model.predict(future)
    tail = forecast.tail(test_len)
    return {
        'values': tail['yhat'].tolist(),
        'low': tail['yhat_lower'].tolist(),
        'high': tail['yhat_upper'].tolist(),
    }


def run_arima(train_df, test_len, freq):
    """Auto-selects (p,d,q)(P,D,Q,s) by AIC via pmdarima instead of a fixed
    order — the single biggest accuracy lever for ARIMA. Falls back to a
    fixed SARIMAX order if pmdarima can't converge on very short series."""
    y = train_df.set_index('ds')['y'].asfreq(freq).interpolate()
    seasonal_period = FREQ_TO_PERIODS_PER_YEAR.get(freq, 12)
    use_seasonal = len(y) >= seasonal_period * 2 and seasonal_period > 1

    with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
        try:
            import pmdarima as pm
            model = pm.auto_arima(
                y,
                seasonal=use_seasonal,
                m=seasonal_period if use_seasonal else 1,
                suppress_warnings=True,
                error_action='ignore',
                stepwise=True,
                max_p=3, max_q=3, max_order=8,
            )
            mean, conf_int = model.predict(n_periods=test_len, return_conf_int=True, alpha=0.2)
            mean = list(mean)
            low = [c[0] for c in conf_int]
            high = [c[1] for c in conf_int]
        except Exception:
            from statsmodels.tsa.statespace.sarimax import SARIMAX
            seasonal_order = (1, 0, 0, seasonal_period) if use_seasonal else (0, 0, 0, 0)
            fit = SARIMAX(y, order=(1, 1, 1), seasonal_order=seasonal_order,
                           enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
            pred = fit.get_forecast(steps=test_len)
            mean = pred.predicted_mean.tolist()
            ci = pred.conf_int(alpha=0.2)
            low, high = ci.iloc[:, 0].tolist(), ci.iloc[:, 1].tolist()

    return {'values': mean, 'low': low, 'high': high}


def run_holt_winters(train_df, test_len, freq):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    y = train_df.set_index('ds')['y'].asfreq(freq).interpolate()
    seasonal_period = FREQ_TO_PERIODS_PER_YEAR.get(freq, 12)
    use_seasonal = len(y) >= seasonal_period * 2 and seasonal_period > 1
    with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
        model = ExponentialSmoothing(
            y, trend='add',
            seasonal='add' if use_seasonal else None,
            seasonal_periods=seasonal_period if use_seasonal else None,
        )
        fit = model.fit()
        forecast = fit.forecast(test_len)
    values = forecast.tolist()
    resid_std = float(np.std(fit.resid)) if len(fit.resid) else 0.0
    return {
        'values': values,
        'low': [v - 1.28 * resid_std for v in values],
        'high': [v + 1.28 * resid_std for v in values],
    }


def _make_tree_features(series: pd.Series) -> pd.DataFrame:
    """Lag, rolling-stat, and calendar features shared by XGBoost and
    LightGBM. Rolling mean/std give the trees a sense of recent level and
    volatility that a bare lag list can't — without this, a tree model on a
    steadily trending series tends to under-shoot every step because it has
    no direct signal for "this keeps climbing", only point-in-time lags."""
    feat = pd.DataFrame({'y': series.values}, index=series.index)
    for lag in (1, 2, 3, 6, 12):
        feat[f'lag_{lag}'] = feat['y'].shift(lag)
    feat['roll_mean_3'] = feat['y'].shift(1).rolling(3).mean()
    feat['roll_mean_6'] = feat['y'].shift(1).rolling(6).mean()
    feat['roll_std_3'] = feat['y'].shift(1).rolling(3).std()
    feat['diff_1'] = feat['y'].diff(1)
    feat['month'] = feat.index.month
    feat['quarter'] = feat.index.quarter
    feat['trend'] = np.arange(len(feat))
    return feat


def _recursive_tree_forecast(model, y_train: pd.Series, test_len: int, freq: str, X_cols: list):
    """Steps forward one period at a time, feeding each prediction back in as
    the next lag/rolling input — a tree model has no closed form for the
    future, so this is the only way to get more than one step ahead."""
    history = list(y_train.values)
    step = FREQ_TO_PANDAS_STEP.get(freq, freq)
    future_index = pd.date_range(start=y_train.index[-1], periods=test_len + 1, freq=step)[1:]

    preds = []
    for ts in future_index:
        recent = pd.Series(history)
        row = {}
        for lag in (1, 2, 3, 6, 12):
            row[f'lag_{lag}'] = history[-lag] if len(history) >= lag else history[0]
        row['roll_mean_3'] = recent.tail(3).mean()
        row['roll_mean_6'] = recent.tail(6).mean()
        row['roll_std_3'] = recent.tail(3).std() if len(recent) >= 2 else 0.0
        row['diff_1'] = history[-1] - history[-2] if len(history) >= 2 else 0.0
        row['month'] = ts.month
        row['quarter'] = ts.quarter
        row['trend'] = len(history)
        x = pd.DataFrame([row])[X_cols].fillna(0)
        yhat = float(model.predict(x)[0])
        preds.append(yhat)
        history.append(yhat)
    return preds


def run_xgboost(train_df, test_len, freq):
    from xgboost import XGBRegressor
    y_train = train_df.set_index('ds')['y'].asfreq(freq).interpolate()
    feat = _make_tree_features(y_train).dropna()
    if len(feat) < 5:
        raise ValueError('not enough history for XGBoost features')

    X_cols = [c for c in feat.columns if c != 'y']
    model = XGBRegressor(n_estimators=300, max_depth=4, learning_rate=0.05,
                          subsample=0.9, colsample_bytree=0.9, verbosity=0)
    model.fit(feat[X_cols], feat['y'])

    preds = _recursive_tree_forecast(model, y_train, test_len, freq, X_cols)
    resid = feat['y'] - model.predict(feat[X_cols])
    resid_std = float(np.std(resid))
    return {
        'values': preds,
        'low': [v - 1.28 * resid_std for v in preds],
        'high': [v + 1.28 * resid_std for v in preds],
    }


def run_lightgbm(train_df, test_len, freq):
    from lightgbm import LGBMRegressor
    y_train = train_df.set_index('ds')['y'].asfreq(freq).interpolate()
    feat = _make_tree_features(y_train).dropna()
    if len(feat) < 5:
        raise ValueError('not enough history for LightGBM features')

    X_cols = [c for c in feat.columns if c != 'y']
    model = LGBMRegressor(n_estimators=300, max_depth=4, learning_rate=0.05,
                           subsample=0.9, colsample_bytree=0.9, min_child_samples=3,
                           verbosity=-1)
    with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
        model.fit(feat[X_cols], feat['y'])

    preds = _recursive_tree_forecast(model, y_train, test_len, freq, X_cols)
    resid = feat['y'] - model.predict(feat[X_cols])
    resid_std = float(np.std(resid))
    return {
        'values': preds,
        'low': [v - 1.28 * resid_std for v in preds],
        'high': [v + 1.28 * resid_std for v in preds],
    }


MODEL_RUNNERS = {
    'prophet': run_prophet,
    'arima': run_arima,
    'holt_winters': run_holt_winters,
    'xgboost': run_xgboost,
    'lightgbm': run_lightgbm,
}

MODEL_LABELS = {
    'prophet': 'Prophet',
    'arima': 'ARIMA (auto)',
    'holt_winters': 'Holt-Winters',
    'xgboost': 'XGBoost',
    'lightgbm': 'LightGBM',
    'ensemble': 'Ensemble (top 2)',
}


def run_one_model(key, train_df, test_len, freq):
    """Dispatches to the right runner; only the tree models need the extra
    feature-engineering path, everything else takes the plain signature."""
    runner = MODEL_RUNNERS[key]
    return runner(train_df, test_len, freq)


def build_ensemble(component_outputs: dict, backtest_mape: dict):
    """Inverse-MAPE-weighted average of the two most accurate component
    models on this series' own backtest — not a fixed blend, since which
    two models deserve the most weight is different for every dataset."""
    ranked = sorted(component_outputs.keys(), key=lambda k: backtest_mape.get(k, float('inf')))
    top2 = ranked[:2]
    if len(top2) < 2:
        return None

    weights = []
    for k in top2:
        mape = max(backtest_mape.get(k, 1.0), 0.01)  # floor so a ~0% MAPE can't divide by zero
        weights.append(1.0 / mape)
    total_w = sum(weights)
    weights = [w / total_w for w in weights]

    n = len(component_outputs[top2[0]]['values'])
    values = [sum(weights[i] * component_outputs[top2[i]]['values'][t] for i in range(2)) for t in range(n)]
    low = [sum(weights[i] * component_outputs[top2[i]]['low'][t] for i in range(2)) for t in range(n)]
    high = [sum(weights[i] * component_outputs[top2[i]]['high'][t] for i in range(2)) for t in range(n)]
    return {'values': values, 'low': low, 'high': high, 'components': top2, 'weights': dict(zip(top2, weights))}


@app.route('/run', methods=['POST'])
def run_single():
    """Runs one named model end-to-end: backtest for an honest accuracy
    score, then a full-series refit for the actual future forecast — the
    same two-pass shape /compare uses per model, just for one instead of
    all of them. This is what lets the Predictions page's algorithm picker
    actually use ARIMA/Holt-Winters/XGBoost/LightGBM, not just Model Arena's
    side-by-side comparison."""
    try:
        data = request.get_json() or {}
        dataset = data.get('dataset', [])
        date_values = data.get('date_values', [])
        freq = data.get('freq', 'MS')
        horizon = int(data.get('interval', 6))
        model_key = data.get('model')

        if model_key not in MODEL_RUNNERS:
            return jsonify({'error': f"Unknown model '{model_key}'"}), 400
        if len(dataset) != len(date_values):
            return jsonify({'error': 'Length of dataset and date_values must be equal'}), 400

        df = clean_and_prepare(date_values, dataset)
        if df.empty:
            return jsonify({'error': 'No valid date/value pairs after cleaning'}), 400

        n = len(df)
        accuracy, mape = None, None
        if n >= 10:
            holdout = max(2, min(12, int(round(n * 0.2))))
            train_df = df.iloc[:-holdout].reset_index(drop=True)
            test_df = df.iloc[-holdout:].reset_index(drop=True)
            try:
                backtest_out = run_one_model(model_key, train_df, holdout, freq)
                accuracy, mape = score(test_df['y'].tolist(), backtest_out['values'])
            except Exception as e:
                print('Backtest skipped:', str(e))

        out = run_one_model(model_key, df, horizon, freq)

        step = FREQ_TO_PANDAS_STEP.get(freq, freq)
        last_ts = df['ds'].iloc[-1]
        future_index = pd.date_range(start=last_ts, periods=horizon + 1, freq=step)[1:]

        forecast = [
            {
                'label': future_index[i].strftime('%Y-%m-%d'),
                'value': round(float(out['values'][i]), 2),
                'low': round(float(out['low'][i]), 2),
                'high': round(float(out['high'][i]), 2),
            }
            for i in range(horizon)
        ]

        return jsonify({
            'forecast': forecast,
            'accuracy': accuracy,
            'mape': mape,
            'model_type': f'{model_key}_model',
            'model_name': f'arena_{model_key}',
        }), 200

    except Exception as e:
        print('Error:', str(e))
        return jsonify({'error': str(e)}), 500


@app.route('/compare', methods=['POST'])
def compare():
    try:
        data = request.get_json() or {}
        dataset = data.get('dataset', [])
        date_values = data.get('date_values', [])
        freq = data.get('freq', 'MS')
        horizon = int(data.get('interval', 6))
        requested = data.get('models') or list(MODEL_RUNNERS.keys())
        include_ensemble = 'ensemble' in requested or not data.get('models')
        requested = [k for k in requested if k in MODEL_RUNNERS]

        if len(dataset) != len(date_values):
            return jsonify({'error': 'Length of dataset and date_values must be equal'}), 400

        df = clean_and_prepare(date_values, dataset)
        if df.empty:
            return jsonify({'error': 'No valid date/value pairs after cleaning'}), 400

        n = len(df)
        if n < 10:
            return jsonify({'error': f'Not enough history to compare models ({n} rows; need at least 10).'}), 400

        holdout = max(2, min(12, int(round(n * 0.2))))
        train_df = df.iloc[:-holdout].reset_index(drop=True)
        test_df = df.iloc[-holdout:].reset_index(drop=True)
        actual = test_df['y'].tolist()

        # Backtest fits run in parallel — each releases the GIL during its
        # heavy C/Fortran work, so this is a real wall-clock win, not just
        # cosmetic concurrency.
        backtest_outputs = {}
        results = {}
        with ThreadPoolExecutor(max_workers=min(6, len(requested) or 1)) as pool:
            futures = {pool.submit(run_one_model, key, train_df, holdout, freq): key for key in requested}
            for future in as_completed(futures):
                key = futures[future]
                try:
                    out = future.result()
                    backtest_outputs[key] = out
                    accuracy, mape = score(actual, out['values'])
                    results[key] = {
                        'label': MODEL_LABELS[key],
                        'ok': True,
                        'accuracy': accuracy,
                        'mape': mape,
                        'backtest': [
                            {'label': test_df['ds'].iloc[i].strftime('%Y-%m-%d'), 'actual': actual[i], 'predicted': round(out['values'][i], 2)}
                            for i in range(holdout)
                        ],
                    }
                except Exception as e:
                    results[key] = {'label': MODEL_LABELS.get(key, key), 'ok': False, 'error': str(e)}

        # Ensemble is derived from the others' backtest performance, so it's
        # computed after they finish rather than fitted independently.
        if include_ensemble:
            backtest_mape = {k: v['mape'] for k, v in results.items() if v.get('ok') and v.get('mape') is not None}
            ensemble_backtest = build_ensemble(backtest_outputs, backtest_mape)
            if ensemble_backtest:
                accuracy, mape = score(actual, ensemble_backtest['values'])
                results['ensemble'] = {
                    'label': f"{MODEL_LABELS['ensemble']}: {' + '.join(MODEL_LABELS[c] for c in ensemble_backtest['components'])}",
                    'ok': True,
                    'accuracy': accuracy,
                    'mape': mape,
                    'backtest': [
                        {'label': test_df['ds'].iloc[i].strftime('%Y-%m-%d'), 'actual': actual[i], 'predicted': round(ensemble_backtest['values'][i], 2)}
                        for i in range(holdout)
                    ],
                }

        # Refit on the FULL series for the real future forecast — the
        # backtest above only ever predicted already-recorded history.
        full_outputs = {}
        forecasts = {}
        with ThreadPoolExecutor(max_workers=min(6, len(requested) or 1)) as pool:
            futures = {
                pool.submit(run_one_model, key, df, horizon, freq): key
                for key in requested if results.get(key, {}).get('ok')
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    full_outputs[key] = future.result()
                except Exception as e:
                    forecasts[key] = {'error': str(e)}

        if include_ensemble and results.get('ensemble', {}).get('ok'):
            components = None
            backtest_mape = {k: v['mape'] for k, v in results.items() if v.get('ok') and v.get('mape') is not None and k != 'ensemble'}
            ensemble_full = build_ensemble(full_outputs, backtest_mape)
            if ensemble_full:
                full_outputs['ensemble'] = ensemble_full

        step = FREQ_TO_PANDAS_STEP.get(freq, freq)
        last_ts = df['ds'].iloc[-1]
        future_index = pd.date_range(start=last_ts, periods=horizon + 1, freq=step)[1:]

        for key, out in full_outputs.items():
            forecasts[key] = [
                {
                    'label': future_index[i].strftime('%Y-%m-%d'),
                    'value': round(float(out['values'][i]), 2),
                    'low': round(float(out['low'][i]), 2),
                    'high': round(float(out['high'][i]), 2),
                }
                for i in range(horizon)
            ]

        ranked = sorted(
            [k for k, v in results.items() if v.get('ok') and v.get('accuracy') is not None],
            key=lambda k: results[k]['accuracy'],
            reverse=True,
        )

        return jsonify({
            'results': results,
            'forecasts': forecasts,
            'best_model': ranked[0] if ranked else None,
            'ranking': ranked,
            'holdout_size': holdout,
        }), 200

    except Exception as e:
        print('Error:', str(e))
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Own port so a slow multi-model comparison never queues behind (or
    # blocks) the single-model train/predict services used by the normal
    # forecast flow.
    app.run(host='127.0.0.1', port=7080, threaded=True)
