from flask import Flask, request, jsonify
import joblib
import os
import pandas as pd

app = Flask(__name__)

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")


@app.route('/predict', methods=['POST'])
def predict():
    """Forecast from an already-trained model, skipping the ~60s Prophet fit.

    A saved model can project any horizon, so only a change to the training
    data, target column or frequency requires a retrain — the caller decides
    that and falls back to /api on port 7000 when it does.

    Supports exogenous variables (regressors) via the 'regressors' parameter:
    [
      {
        "name": "marketing_spend",
        "future_values": [100, 150, 200, ...]  # must match periods
      }
    ]
    """
    try:
        data = request.get_json() or {}
        model_name = data.get("model_name")
        periods = int(data.get("interval", 5))
        freq = data.get("freq", "D")
        regressors = data.get("regressors", [])

        if not model_name:
            return jsonify({"error": "model_name is required."}), 400

        # Callers refer to models by name; the file carries the .pkl suffix.
        filename = model_name if model_name.endswith(".pkl") else model_name + ".pkl"
        # Guard against a caller reaching outside the models directory.
        if os.path.basename(filename) != filename:
            return jsonify({"error": "Invalid model name."}), 400

        model_path = os.path.join(MODELS_DIR, filename)
        if not os.path.exists(model_path):
            return jsonify({"error": f"Model '{model_name}' not found."}), 404

        model = joblib.load(model_path)
        future = model.make_future_dataframe(periods=periods, freq=freq)

        # Add future regressor values if provided
        for regressor in regressors:
            regressor_name = regressor.get("name")
            future_values = regressor.get("future_values", [])
            if regressor_name and len(future_values) == periods:
                future[regressor_name] = pd.to_numeric(future_values, errors='coerce')

        forecast = model.predict(future)

        result = (forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']]
                  .tail(periods)
                  .to_dict(orient="records"))
        return jsonify({"forecast": result}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # Bound to localhost: only the PHP API on this machine should reach it,
    # and the Werkzeug debugger must never be exposed.
    # threaded: the default dev server handles one request at a time, so a
    # second forecast would queue behind a fit that can take minutes.
    app.run(host='127.0.0.1', port=7070, threaded=True)
