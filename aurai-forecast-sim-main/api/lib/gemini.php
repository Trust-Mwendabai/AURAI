<?php
/**
 * Gemini client.
 *
 * The app works without it: every caller falls back to the built-in analysis,
 * which reads the same figures but writes them up from fixed templates. Gemini
 * adds reasoning on top — explaining *why* a pattern matters and what to do
 * about it — rather than being the only thing between the user and an answer.
 *
 * The key lives in api/config.local.php (gitignored) and is never sent to the
 * browser: every call is made from here, server side.
 */

/**
 * Tokens reserved for the model's internal reasoning, on top of whatever the
 * caller asks for as an answer. Measured at roughly 300 for a short prompt at
 * the low thinking level and more for a workspace-sized one; 1500 leaves room
 * without letting a stalled chain of thought run long.
 */
const GEMINI_THINKING_HEADROOM = 1500;

/**
 * Models tried in order when the configured one cannot answer.
 *
 * The free tier meters requests *per model* — 20 a day each, at the time of
 * writing — so a spent quota on one model says nothing about the next. Moving
 * down this list turns a single hard daily ceiling into several, which is the
 * difference between reasoning being available and being a rarity.
 *
 * They are ordered by capability, so a user only drops to a lighter model once
 * the better one is genuinely unavailable.
 */
const GEMINI_FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.5-flash-lite'];

function gemini_config(): array {
    static $config = null;
    if ($config === null) {
        $file = __DIR__ . '/../config.local.php';
        $config = is_file($file) ? (require $file) : [];
        // An environment variable wins, so deployments need no file edit.
        if (getenv('GEMINI_API_KEY')) $config['gemini_api_key'] = getenv('GEMINI_API_KEY');
    }
    return $config;
}

function gemini_available(): bool {
    $key = gemini_config()['gemini_api_key'] ?? '';
    return is_string($key) && strlen(trim($key)) > 10;
}

/**
 * The models to try, best first, with duplicates removed.
 *
 * A deployment can replace the chain wholesale through `gemini_models` in the
 * config, which is how a paid project pins one model and skips the rest.
 */
function gemini_model_chain(array $options = []): array {
    $config = gemini_config();
    if (!empty($config['gemini_models']) && is_array($config['gemini_models'])) {
        return array_values($config['gemini_models']);
    }
    $primary = $options['model'] ?? ($config['gemini_model'] ?? 'gemini-3.6-flash');
    return array_values(array_unique(array_merge([$primary], GEMINI_FALLBACK_MODELS)));
}

/**
 * Sends a prompt and returns the reply, or null if Gemini cannot answer.
 *
 * Returning null rather than throwing is deliberate: an unreachable model,
 * an expired key or a safety block should degrade the answer, never break the
 * page. Callers substitute their own analysis when this returns null.
 *
 * @param string $system Instructions describing the role and the house style.
 * @param string $user   The question plus the factual context it must use.
 */
function gemini_generate(string $system, string $user, array $options = []): ?string {
    if (!gemini_available()) return null;

    // maxOutputTokens caps the model's thinking *and* its prose from one
    // budget, and thinking runs first. Asked for 900 tokens, the model spent
    // 600 of them reasoning and returned a sentence cut in half — so the
    // caller's figure is treated as the answer length and the headroom for
    // thinking is added on top of it.
    $answerTokens = $options['maxOutputTokens'] ?? 1200;

    $payload = [
        'systemInstruction' => ['parts' => [['text' => $system]]],
        'contents' => [['role' => 'user', 'parts' => [['text' => $user]]]],
        'generationConfig' => [
            // Low temperature: these answers report on real figures, so
            // invention is a defect rather than a flourish.
            'temperature' => $options['temperature'] ?? 0.3,
            'maxOutputTokens' => $answerTokens + GEMINI_THINKING_HEADROOM,
            // Some reasoning genuinely improves the analysis; a lot of it just
            // costs latency on questions this grounded.
            'thinkingConfig' => ['thinkingLevel' => $options['thinkingLevel'] ?? 'low'],
        ],
    ];

    // A deadline across the whole chain, not just each model. Three models that
    // each retry a 503 can otherwise add up to most of a minute before the
    // fallback answers, and a user waiting that long for advice would rather
    // have had the built-in version immediately.
    $deadline = microtime(true) + ($options['totalTimeout'] ?? 30);

    foreach (gemini_model_chain($options) as $model) {
        $remaining = (int)floor($deadline - microtime(true));
        if ($remaining < 5) {
            error_log('Gemini: out of time before trying ' . $model . '; falling back.');
            return null;
        }

        [$status, $body, $error] = gemini_request($model, $payload, min($options['timeout'] ?? 25, $remaining));

        if ($error !== null) {
            // The network is the problem, not the model, so trying another one
            // would only repeat the wait.
            error_log("Gemini unreachable: $error");
            return null;
        }

        // A spent quota, a retired model, or one still overloaded after its
        // retry are all specific to *this* model. The next in the chain has
        // its own allowance and its own load, so it is worth asking.
        if ($status === 429 || $status === 404 || $status === 503) {
            error_log("Gemini $model unavailable (HTTP $status); trying the next model.");
            continue;
        }
        if ($status !== 200) {
            error_log("Gemini HTTP $status: " . substr((string)$body, 0, 300));
            return null;
        }

        // A safety block or a truncated reply comes back as null, and would
        // recur on any model given the same prompt, so the chain stops here
        // and the caller's own analysis answers.
        return gemini_extract_text((string)$body);
    }

    error_log('Gemini: every model in the chain was unavailable.');
    return null;
}

/**
 * One HTTP round trip, retried once on a busy model.
 *
 * A 503 means the model is momentarily overloaded rather than wrong, and it is
 * common enough to visibly cost answers; one short retry recovers most of them.
 *
 * @return array{0:int,1:string|false,2:string|null} status, body, transport error
 */
function gemini_request(string $model, array $payload, int $timeout): array {
    $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";
    $key = gemini_config()['gemini_api_key'];

    $attempts = 0;
    do {
        if ($attempts > 0) usleep(1200000);
        $attempts++;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-goog-api-key: ' . $key,
            ],
            // Short enough that a stalled model never holds a page open.
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 8,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_errno($ch) ? curl_error($ch) : null;
        curl_close($ch);
    } while ($attempts < 2 && $error === null && $status === 503);

    return [$status, $body, $error];
}

/**
 * Pulls the answer out of a 200 response, or null if there isn't a usable one.
 *
 * A safety block, an empty candidate and reasoning that consumed the whole
 * token budget all look like success at the HTTP layer, so each is checked
 * here rather than assumed away.
 */
function gemini_extract_text(string $body): ?string {
    $candidate = json_decode($body, true)['candidates'][0] ?? [];
    $finish = $candidate['finishReason'] ?? '';

    // Every part is joined, not just the first. A thinking model splits an
    // answer across several parts, and reading only parts[0] silently returned
    // the opening paragraph as though it were the whole reply — a truncation
    // the API never reports, because as far as it is concerned it finished.
    // Parts flagged as `thought` are the model's reasoning, not its answer.
    $text = '';
    foreach ($candidate['content']['parts'] ?? [] as $part) {
        if (!empty($part['thought'])) continue;
        if (isset($part['text'])) $text .= $part['text'];
    }

    if (trim($text) === '') {
        error_log('Gemini returned no usable text (finish=' . $finish . '): ' . substr($body, 0, 300));
        return null;
    }
    if ($finish === 'MAX_TOKENS') {
        // The reply stops mid-sentence. The caller's own analysis is a better
        // answer than a truncated one.
        error_log('Gemini answer truncated at the token limit; falling back.');
        return null;
    }
    return trim($text);
}

/**
 * The house style shared by every prompt.
 *
 * The rules draw one line: facts are given, judgement is expected. An earlier
 * version forbade going beyond the data at all, and the model answered "what
 * should I focus on next quarter" by saying the workspace held no strategic
 * recommendations — accurate, and useless. A fabricated *figure* would be
 * acted on and is still forbidden; a conclusion drawn from real figures is the
 * entire point of asking.
 */
function gemini_system_prompt(string $role): string {
    return "$role\n\n" .
        "What you are for:\n" .
        "- Answer the question that was asked. An adviser who lists what they cannot address has not advised.\n" .
        "- Draw conclusions and recommend actions. Interpretation, judgement and advice are yours to give; " .
        "only the numbers and names must come from the data.\n" .
        "- Where the data narrows an answer rather than blocking it, give the answer the data does support " .
        "and name the one thing that would sharpen it. Say the data cannot answer only when it truly cannot.\n\n" .
        "Rules you must follow:\n" .
        "- Never invent a number, a date, a product or a trend. Quote figures exactly as provided, " .
        "with their units or percentages.\n" .
        "- Be direct and concrete. No filler, no restating the question, no offers to help further.\n" .
        "- Write in British English, in plain prose a business reader would use.\n" .
        "- Use **bold** only to highlight a figure or a name. Never use headings deeper than ##.\n" .
        "- Where a forecast's accuracy is weak, say what that means for acting on it.";
}
