<?php
/**
 * Template for api/config.local.php. Copy it, fill in your keys, and keep the
 * copy out of version control.
 *
 * Without a Gemini key the app still works: the assistant, the business
 * adviser and report generation fall back to their built-in analysis, which
 * reads the same data but writes it up from fixed templates rather than
 * reasoning about it.
 */

return [
    'gemini_api_key' => '',
    'gemini_model' => 'gemini-3.6-flash',

    // Optional. Replaces the whole model chain rather than adding to it, so a
    // paid project can pin one model instead of falling down the free-tier
    // list. Leave it out to keep the built-in chain.
    // 'gemini_models' => ['gemini-3.6-flash'],

    // Where the two Flask + Prophet services listen. The defaults match
    // running them locally as described in the deployment guide; set these
    // only if Python runs on another port or another host.
    // 'prophet_train_url'   => 'http://127.0.0.1:7000/api',
    // 'prophet_predict_url' => 'http://127.0.0.1:7070/predict',
];
