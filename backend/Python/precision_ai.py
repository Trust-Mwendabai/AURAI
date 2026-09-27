from flask import Flask, request, jsonify
from prophet import Prophet
import pandas as pd
import json
import os
import joblib
import contextlib
from sklearn.metrics import mean_absolute_percentage_error
from datetime import datetime

app = Flask(__name__)

from datetime import datetime
import pandas as pd

def clean_and_prepare_for_prophet(ds_raw, y_raw):
    cleaned_ds = []

    for val in ds_raw:
        try:
            if isinstance(val, pd.Timestamp) or isinstance(val, datetime):
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

        except:
            cleaned_ds.append(None)

    df = pd.DataFrame({'ds': cleaned_ds, 'y': y_raw})
    df = df.dropna(subset=['ds', 'y'])

    # if y is a number
    df['y'] = pd.to_numeric(df['y'], errors='coerce')
    df = df.dropna(subset=['y'])

    # remove dates far in the past
    # df = df[df['ds'] >= pd.Timestamp("2000-01-01")]

    df = df.sort_values('ds').reset_index(drop=True)
    return df

def backtest(df, freq, changepoint_prior_scale=0.05, seasonality_mode='additive', seasonality_prior_scale=10.0):
    """Score the model by holding out the end of the series.

    The previous implementation compared a flat line (the last training value
    repeated) against the actuals and reported that as the model's accuracy —
    Prophet's own predictions were never involved, so the figure described the
    data's volatility rather than the model.

    This fits Prophet on the earlier portion only, predicts the held-out tail,
    and measures the error of those predictions. The same flat-line forecast is
    scored alongside as a baseline, so the caller can tell whether the model
    actually beat doing nothing.

    The three keyword params default to Prophet's own defaults, so ordinary
    calls behave exactly as before; tune_hyperparameters() below is the only
    caller that overrides them, one grid combination at a time.

    Returns (accuracy, mape, baseline_mape, note). Any of the numbers may be
    None when the series is too short to evaluate honestly.
    """
    n = len(df)
    # Fewer than ~10 points cannot be split without the training half becoming
    # meaningless, and a score from 2 test points says nothing.
    if n < 10:
        return None, None, None, f"Not scored: {n} rows is too few to hold data back for testing."

    holdout = max(2, min(12, int(round(n * 0.2))))
    train_df = df.iloc[:-holdout]
    test_df = df.iloc[-holdout:]

    try:
        with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
            # Only point predictions are scored here, so interval sampling is
            # skipped. It saves little — the fit itself dominates — but there
            # is no reason to compute bounds that are thrown away. The
            # delivered forecast still gets full intervals from the main fit.
            trial = Prophet(
                uncertainty_samples=0,
                changepoint_prior_scale=changepoint_prior_scale,
                seasonality_mode=seasonality_mode,
                seasonality_prior_scale=seasonality_prior_scale,
            )

            # Add regressors from training data if present
            for col in train_df.columns:
                if col not in ['ds', 'y']:
                    trial.add_regressor(col)

            trial.fit(train_df)
            future = trial.make_future_dataframe(periods=holdout, freq=freq)

            # Add regressor values for forecast period from test set
            for col in train_df.columns:
                if col not in ['ds', 'y']:
                    future_values = test_df[col].values
                    future.loc[future['ds'].isin(test_df['ds']), col] = future_values

            predicted = trial.predict(future).set_index('ds')['yhat']
    except Exception as e:
        return None, None, None, f"Not scored: the evaluation fit failed ({e})."

    actual, model_pred, naive_pred = [], [], []
    last_train_value = float(train_df['y'].iloc[-1])

    for _, row in test_df.iterrows():
        # MAPE is undefined at zero, so those rows are left out rather than
        # allowed to produce a meaningless percentage.
        if float(row['y']) == 0.0:
            continue
        if row['ds'] not in predicted.index:
            continue
        actual.append(float(row['y']))
        model_pred.append(float(predicted.loc[row['ds']]))
        naive_pred.append(last_train_value)

    if len(actual) < 2:
        return None, None, None, "Not scored: too few comparable points in the holdout period."

    mape = round(mean_absolute_percentage_error(actual, model_pred) * 100, 2)
    baseline = round(mean_absolute_percentage_error(actual, naive_pred) * 100, 2)
    # A model can be worse than useless; clamping at 0 avoids a negative
    # "accuracy", which would read as a scale error rather than a bad model.
    accuracy = round(max(0.0, 100 - mape), 2)
    return accuracy, mape, baseline, None


# A small, fixed grid rather than a real Bayesian search — each combination
# costs one more Prophet fit, and fits are already the slow part of this
# app (per the module-level comment on why saved models are reused). Nine
# combinations keeps a tune request in the tens-of-seconds range instead of
# minutes, which is why this is its own explicit action rather than
# something that runs on every forecast.
TUNING_GRID = {
    'changepoint_prior_scale': [0.01, 0.05, 0.5],
    'seasonality_mode': ['additive', 'multiplicative'],
    'seasonality_prior_scale': [1.0, 10.0],
}


def tune_hyperparameters(df, freq):
    """Tries each combination in TUNING_GRID through the same backtest()
    used to score the default fit, and returns the combination with the
    lowest MAPE alongside every combination's result — so the caller (and
    the person reading the UI) can see it wasn't a black box.
    """
    combos = [
        {'changepoint_prior_scale': cps, 'seasonality_mode': sm, 'seasonality_prior_scale': sps}
        for cps in TUNING_GRID['changepoint_prior_scale']
        for sm in TUNING_GRID['seasonality_mode']
        for sps in TUNING_GRID['seasonality_prior_scale']
    ]

    results = []
    for params in combos:
        accuracy, mape, baseline, note = backtest(df, freq, **params)
        results.append({**params, 'accuracy': accuracy, 'mape': mape, 'note': note})

    scored = [r for r in results if r['mape'] is not None]
    if not scored:
        return None, results

    best = min(scored, key=lambda r: r['mape'])
    return best, results


@app.route('/tune', methods=['POST'])
def tune():
    try:
        data = request.json
        dataset = data.get('dataset', [])
        date_values = data.get('date_values', [])
        freq = data.get('freq', 'MS')

        if len(dataset) != len(date_values):
            return jsonify({"error": "Length of dataset and date_values must be equal"}), 400

        df = clean_and_prepare_for_prophet(date_values, dataset)
        if df.empty:
            return jsonify({"error": "No valid date/value pairs after cleaning"}), 400
        if len(df) < 10:
            return jsonify({"error": f"Not enough history to tune ({len(df)} rows; need at least 10)."}), 400

        best, all_results = tune_hyperparameters(df, freq)
        if not best:
            return jsonify({"error": "No combination could be scored on this data."}), 502

        # The default combination, scored the same way, so the UI can show
        # the improvement rather than just the winning numbers in isolation.
        default_accuracy, default_mape, _, _ = backtest(df, freq)

        return jsonify({
            "best_params": {
                "changepoint_prior_scale": best['changepoint_prior_scale'],
                "seasonality_mode": best['seasonality_mode'],
                "seasonality_prior_scale": best['seasonality_prior_scale'],
            },
            "best_accuracy": best['accuracy'],
            "best_mape": best['mape'],
            "default_accuracy": default_accuracy,
            "default_mape": default_mape,
            "all_results": all_results,
        }), 200

    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 500


@app.route('/api', methods=['POST'])
def process():
    try:
        data = request.json

        system_name = data.get('system', 'Guest')
        interval = data.get('interval', 5)  
        dataset = data.get('dataset', [])
        date_values = data.get('date_values', [])
        project_id = data.get('project_id', 777)
        # Defaults to yearly so existing callers keep their behavior.
        freq = data.get('freq', 'Y')

        if len(dataset) != len(date_values):
            return jsonify({"error": "Length of dataset and date_values must be equal"}), 400

        df = clean_and_prepare_for_prophet(date_values, dataset)

        if df.empty:
            return jsonify({"error": "No valid date/value pairs after cleaning"}), 400

        # Handle exogenous variables (regressors) if provided
        regressors = data.get('regressors', [])
        for regressor in regressors:
            regressor_name = regressor.get('name')
            regressor_values = regressor.get('values', [])
            if regressor_name and len(regressor_values) == len(df):
                df[regressor_name] = pd.to_numeric(regressor_values, errors='coerce')

        # Optional — set by the Predictions page after a /tune run finds a
        # combination that beat Prophet's defaults on this data. Omitted,
        # Prophet() falls back to its own defaults exactly as before.
        tuned = data.get('tuned_params') or {}
        prophet_kwargs = {
            k: tuned[k] for k in ('changepoint_prior_scale', 'seasonality_mode', 'seasonality_prior_scale')
            if k in tuned
        }
        model = Prophet(**prophet_kwargs)

        # Add regressors to the model
        for regressor in regressors:
            regressor_name = regressor.get('name')
            if regressor_name and regressor_name in df.columns:
                model.add_regressor(regressor_name)

        model.fit(df)

        future = model.make_future_dataframe(periods=interval, freq=freq)

        # Add future regressor values if provided
        for regressor in regressors:
            regressor_name = regressor.get('name')
            future_values = regressor.get('future_values', [])
            if regressor_name and len(future_values) == interval:
                future[regressor_name] = pd.to_numeric(future_values, errors='coerce')

        forecast = model.predict(future)

        future_forecast = forecast[forecast['ds'] > df['ds'].max()]
        forecast_values = future_forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].to_dict(orient='records')

        accuracy, mape, baseline_mape, skip_reason = backtest(df, freq, **prophet_kwargs)

        # Absolute, so models land in the same place regardless of the working
        # directory the service was started from — predict.py reads from here.
        save_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        os.makedirs(save_folder, exist_ok=True)
        model_name = f"timeseries_{project_id}"
        file_path = os.path.join(save_folder, model_name + ".pkl")

        with open(os.devnull, 'w'), contextlib.redirect_stdout(None), contextlib.redirect_stderr(None):
            joblib.dump(model, file_path)

        return jsonify({
            "message": {
                "forecasts": forecast_values,
                "accuracy": accuracy,
                "mape": mape,
                # How a flat-line forecast scored on the same holdout. If the
                # model is not clearly better than this, it has added nothing.
                "baseline_mape": baseline_mape,
                "accuracy_note": skip_reason,
                "model_type": "prophet_model",
                "model_name": model_name
            },
            "status": "saved",
        }), 200

    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Bound to localhost: only the PHP API on this machine calls this service,
    # and it writes model files to disk, so it should not be reachable from the
    # network.
    # threaded: the default dev server handles one request at a time, so a
    # second forecast would queue behind a fit that can take minutes.
    app.run(host='127.0.0.1', port=7000, threaded=True)
