<?php
require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/gemini.php';
require_once __DIR__ . '/lib/workspace_context.php';

/**
 * Answers questions about the signed-in user's workspace by querying the
 * database directly.
 *
 * This is a deterministic assistant, not a language model: it matches a fixed
 * set of intents and describes the real rows behind them. Answers aim to
 * interpret the numbers — what they mean and what to do next — rather than
 * only restating them, since a bare figure rarely tells the user whether their
 * model is any good.
 */
function assistant_ask(string $userId): void {
    $b = json_input();
    $raw = trim((string)($b['question'] ?? ''));
    if ($raw === '') fail('question is required');
    $conversationId = $b['conversationId'] ?? null;

    $question = assistant_normalize($raw);

    $q = function (string $sql, array $params = []) use ($userId) {
        $stmt = db()->prepare($sql);
        $stmt->execute($params + [':uid' => $userId]);
        return $stmt;
    };

    // Gemini answers from a factual snapshot of this user's workspace. The
    // deterministic handlers below remain the fallback, so an unreachable
    // model or a missing key degrades the answer rather than breaking the page.
    //
    // "reasoning": false asks for that fallback directly. It is how the intent
    // router stays testable — a model's wording varies between identical calls,
    // so routing cannot be asserted through an answer it wrote.
    $reasoning = ($b['reasoning'] ?? true) !== false;

    if ($reasoning && gemini_available()) {
        $answer = assistant_reasoned_answer($userId, $raw, $conversationId);
        if ($answer !== null) respond(['answer' => $answer, 'reasoned' => true]);
    }

    [$intent, $score] = assistant_detect_intent($question);

    // A question naming the user's own data ("my weather data", "July sales")
    // is a stronger signal than a weak generic keyword, so it can override a
    // low-confidence match as well as rescue a missing one.
    if ($intent === null || $score < ASSISTANT_CONFIDENT_SCORE) {
        $intent = assistant_intent_from_user_data($userId, $question) ?? $intent;
    }

    // Still nothing, but it reads like a follow-up ("why?", "tell me more") —
    // carry on with whatever the conversation was already about.
    if ($intent === null && $conversationId && assistant_is_followup($question)) {
        $intent = assistant_previous_intent($userId, $conversationId);
    }

    switch ($intent) {
        case 'insights':    respond(['answer' => answer_insights($userId)]);
        case 'accuracy':    respond(['answer' => answer_accuracy($q)]);
        case 'latest':      respond(['answer' => answer_latest_forecast($q)]);
        case 'datasets':    respond(['answer' => answer_datasets($q)]);
        case 'reports':     respond(['answer' => answer_reports($q)]);
        case 'predictions': respond(['answer' => answer_predictions($q)]);
        case 'summary':     respond(['answer' => answer_summary($userId)]);
        case 'greeting':
            respond(['answer' =>
                "Hello. I can look things up in your workspace and explain what they mean.\n\n" .
                "I have access to your datasets, the forecasts you've run, how accurate their models were, and your reports. " .
                "Ask me something like *how accurate are my models*, *what was my latest forecast*, or *what should I do about this*, " .
                "and I'll pull the real numbers and tell you how to read them."]);
    }

    respond(['answer' => assistant_fallback($userId)]);
}

// --- Intent matching -------------------------------------------------------

/**
 * Each intent lists phrases with a weight. Multi-word phrases score higher
 * than single words, so "how many forecasts" lands on predictions rather than
 * being stolen by a stray "forecast" elsewhere in the sentence.
 *
 * Scoring every intent and taking the best beats first-match-wins, where the
 * order of the checks silently decided the answer — "status of my weather
 * data" used to return a workspace summary because `status` was tested first.
 */
const ASSISTANT_INTENTS = [
    'insights' => [
        'what should i do' => 10, 'business insight' => 10, 'what do you recommend' => 10,
        'should i' => 6, 'advice' => 6, 'advise' => 6, 'recommend' => 6, 'insight' => 6,
        'decision' => 5, 'strategy' => 5, 'opportunit' => 5, 'implication' => 5,
        'act on' => 5, 'plan for' => 5, 'risk' => 4, 'action' => 3, 'business' => 3,
    ],
    'accuracy' => [
        'how accurate' => 10, 'how reliable' => 10, 'can i trust' => 10, 'model quality' => 8,
        'accuracy' => 7, 'accurate' => 7, 'reliable' => 6, 'mape' => 6, 'error rate' => 6,
        'how good' => 5, 'trustworthy' => 5, 'confidence' => 4,
    ],
    'latest' => [
        'latest forecast' => 10, 'last forecast' => 10, 'most recent forecast' => 10,
        'what does it predict' => 9, 'what is predicted' => 8, 'projection' => 6,
        'latest' => 5, 'most recent' => 5, 'newest' => 5, 'what does it say' => 5,
    ],
    'datasets' => [
        'my datasets' => 10, 'what data' => 8, 'show me my data' => 8, 'imported' => 7,
        'dataset' => 7, 'data set' => 7, 'spreadsheet' => 6, 'my data' => 6,
        'uploaded' => 6, 'upload' => 5, 'columns' => 4, 'rows' => 3,
    ],
    'reports' => ['report' => 8, 'write up' => 6, 'written' => 4, 'document' => 4],
    'predictions' => [
        'how many forecast' => 10, 'how many prediction' => 10, 'list my forecast' => 9,
        'forecast history' => 8, 'my forecasts' => 8, 'my predictions' => 8,
        'prediction' => 5, 'forecast' => 5, 'model' => 4, 'runs' => 3, 'how many' => 3,
    ],
    'summary' => [
        'workspace summary' => 10, 'give me a summary' => 10, 'how am i doing' => 9,
        'overview' => 7, 'summary' => 7, 'everything' => 5, 'status' => 4, 'workspace' => 4,
    ],
    'greeting' => ['good morning' => 8, 'good afternoon' => 8, 'hello' => 8, 'hey' => 6, 'hi' => 6],
];

// Lowercases, drops punctuation and collapses whitespace, so "What's the
// status of my weather-data?" and "whats the status of my weather data"
// score identically.
function assistant_normalize(string $text): string {
    $t = mb_strtolower($text);
    $t = str_replace(["'", "\u{2019}"], '', $t);
    $t = preg_replace('/[^a-z0-9\s]+/u', ' ', $t);
    return trim(preg_replace('/\s+/', ' ', $t));
}

// Below this, a keyword match is only a hint — one weak generic word like
// "status" rather than a phrase that names what the user wants.
const ASSISTANT_CONFIDENT_SCORE = 6;

/** @return array{0: ?string, 1: int} the best-scoring intent and its score. */
function assistant_detect_intent(string $question): array {
    $padded = " $question ";
    $scores = [];

    foreach (ASSISTANT_INTENTS as $intent => $phrases) {
        $score = 0;
        foreach ($phrases as $phrase => $weight) {
            // Single words match on word boundaries so "hi" doesn't fire
            // inside "this"; longer phrases match as substrings.
            $hit = str_contains($phrase, ' ')
                ? str_contains($question, $phrase)
                : str_contains($padded, " $phrase ") || str_contains($padded, " {$phrase}s ");
            if ($hit) $score += $weight;
        }
        if ($score > 0) $scores[$intent] = $score;
    }

    if (!$scores) return [null, 0];
    arsort($scores);
    $best = array_key_first($scores);
    return [$best, $scores[$best]];
}

/**
 * Routes questions that name the user's own data rather than a feature —
 * "show me July sales" when they have a `sales` column, or "my weather data"
 * when they have a weather dataset.
 */
function assistant_intent_from_user_data(string $userId, string $question): ?string {
    $stmt = db()->prepare('SELECT name, meta FROM datasets WHERE user_id = :uid LIMIT 50');
    $stmt->execute([':uid' => $userId]);

    foreach ($stmt->fetchAll() as $row) {
        // Dataset filenames: match on their words, so "weather data" finds
        // "weather-readings-2026.csv".
        foreach (preg_split('/[^a-z0-9]+/', assistant_normalize($row['name'])) as $word) {
            if (mb_strlen($word) >= 4 && str_contains($question, $word)) return 'datasets';
        }
        $meta = json_decode($row['meta'] ?? '{}', true);
        foreach (($meta['headers'] ?? []) as $header) {
            $h = assistant_normalize((string)$header);
            if (mb_strlen($h) >= 3 && str_contains($question, $h)) return 'latest';
        }
    }

    $stmt = db()->prepare('SELECT DISTINCT target FROM predictions WHERE user_id = :uid AND target IS NOT NULL LIMIT 50');
    $stmt->execute([':uid' => $userId]);
    foreach ($stmt->fetchAll() as $row) {
        $t = assistant_normalize((string)$row['target']);
        if (mb_strlen($t) >= 3 && str_contains($question, $t)) return 'latest';
    }
    return null;
}

// --- Conversation context --------------------------------------------------

// Short, referential messages ("why?", "what about it", "tell me more") only
// make sense against what was already being discussed.
function assistant_is_followup(string $question): bool {
    $cues = ['why', 'how so', 'what about', 'tell me more', 'more detail', 'explain',
             'go on', 'and then', 'what else', 'expand', 'elaborate', 'really', 'it', 'that', 'those'];
    foreach ($cues as $cue) {
        if ($question === $cue || str_starts_with($question, "$cue ") || str_contains($question, " $cue ")) return true;
    }
    return str_word_count($question) <= 4;
}

/**
 * Looks back through the user's recent turns in this conversation for the last
 * question that did resolve to an intent, so a follow-up continues the thread
 * instead of dropping to the generic fallback.
 */
function assistant_previous_intent(string $userId, string $conversationId): ?string {
    $stmt = db()->prepare(
        'SELECT m.content FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = :cid AND c.user_id = :uid AND m.role = :role
         ORDER BY m.seq DESC LIMIT 8'
    );
    $stmt->execute([':cid' => $conversationId, ':uid' => $userId, ':role' => 'user']);

    foreach ($stmt->fetchAll() as $row) {
        $prior = assistant_normalize((string)$row['content']);
        if (assistant_is_followup($prior)) continue;
        [$intent] = assistant_detect_intent($prior);
        if ($intent !== null && $intent !== 'greeting') return $intent;
    }
    return null;
}

// Names what the user actually has, so the suggestions are worth trying.
function assistant_fallback(string $userId): string {
    $stmt = db()->prepare('SELECT
              (SELECT COUNT(*) FROM datasets WHERE user_id = :u1) d,
              (SELECT COUNT(*) FROM predictions WHERE user_id = :u2) p');
    $stmt->execute([':u1' => $userId, ':u2' => $userId]);
    $c = $stmt->fetch();

    $out = "I'm not sure what you're asking for, so let me say what I can do.\n\n" .
        "I read your workspace directly — datasets, forecasts, accuracy scores and reports — and explain what the numbers mean. Try:\n\n" .
        "• **What should I do about this?** — business insights: growth, peaks, risk and what they imply for planning\n" .
        "• **How accurate are my models?** — whether your forecasts are worth trusting\n" .
        "• **What was my latest forecast?** — what it projects and how confident it is\n" .
        "• **Show me my datasets** — what you've imported and what's forecastable\n" .
        "• **Give me a workspace summary** — everything at a glance\n";

    if ((int)$c['d'] === 0) {
        $out .= "\nRight now you have no datasets loaded, so most answers will be empty until you import one on the Dataset page.";
    } elseif ((int)$c['p'] === 0) {
        $out .= sprintf("\nYou have %d dataset%s but no forecasts yet — run one from the Predictions page and I'll have a lot more to say.",
            (int)$c['d'], (int)$c['d'] === 1 ? '' : 's');
    }
    return $out;
}

// The UI stores a period as an adverb ("Monthly"); prose needs the noun.
function period_noun(?string $period): string {
    return [
        'hourly' => 'hour', 'daily' => 'day', 'weekly' => 'week',
        'monthly' => 'month', 'quarterly' => 'quarter', 'yearly' => 'year',
    ][strtolower((string)$period)] ?? 'period';
}

/**
 * Answers by giving the model a factual snapshot of the workspace plus the
 * recent conversation, rather than matching against fixed intents.
 *
 * Returns null when the model is unavailable, which sends the caller back to
 * the deterministic handlers below.
 */
function assistant_reasoned_answer(string $userId, string $question, ?string $conversationId): ?string {
    $context = workspace_context($userId);
    $history = $conversationId ? conversation_context($userId, $conversationId) : '';

    $prompt = "Here is the current state of the user's workspace.\n\n" . $context . "\n";
    if ($history !== '') {
        $prompt .= "\nRecent conversation, oldest first:\n" . $history . "\n";
    }
    $prompt .= "\nTheir question: " . $question . "\n\n"
        . "Answer it directly, reasoning from the workspace data above. Where they ask what to do "
        . "or what something means, give them a recommendation grounded in those figures rather "
        . "than listing what the data lacks. Keep it under 200 words unless a list is asked for.";

    return gemini_generate(
        gemini_system_prompt(
            "You are Aurai, an analyst inside a forecasting tool. You have a snapshot of one "
            . "user's datasets, forecasts and reports, and you advise them on their business from it."
        ),
        $prompt,
        ['maxOutputTokens' => 900],
    );
}

// --- Business insights -----------------------------------------------------

/**
 * Turns the latest forecast and the history behind it into business advice.
 *
 * Everything here is derived from the user's own numbers: growth against
 * recent actuals, where the peak and trough fall, how volatile the series has
 * been, and how wide the model's confidence band is. The advice is phrased as
 * what those figures imply for planning, and is explicitly hedged by the
 * model's accuracy so nobody acts on a weak forecast as if it were certain.
 */
function answer_insights(string $userId, ?string $predictionId = null): string {
    // Defaults to the most recent run, but any saved forecast can be advised
    // on — the Predictions page asks about the one just completed.
    if ($predictionId) {
        $stmt = db()->prepare(
            'SELECT name, target, accuracy, horizon, period, forecast, dataset_id, created_at
             FROM predictions WHERE id = :id AND user_id = :uid'
        );
        $stmt->execute([':id' => $predictionId, ':uid' => $userId]);
    } else {
        $stmt = db()->prepare(
            'SELECT name, target, accuracy, horizon, period, forecast, dataset_id, created_at
             FROM predictions WHERE user_id = :uid ORDER BY created_at DESC LIMIT 1'
        );
        $stmt->execute([':uid' => $userId]);
    }
    $p = $stmt->fetch();

    if (!$p) {
        return "I don't have a forecast to base advice on yet.\n\n" .
               "Once you've run one from the Predictions page I can tell you what it implies — where demand peaks, " .
               "how fast things are growing, how much of a buffer to hold, and how much weight to put on the numbers.";
    }

    $points = json_decode($p['forecast'], true) ?: [];
    if (!$points) return "Your most recent forecast has no data points, so there's nothing to interpret. Try running it again.";

    $values = array_map(fn($x) => (float)($x['value'] ?? 0), $points);
    $labels = array_map(fn($x) => (string)($x['label'] ?? ''), $points);
    $target = $p['target'] ?: 'the target column';
    $period = period_noun($p['period']);
    $accuracy = $p['accuracy'] !== null ? (float)$p['accuracy'] : null;

    $history = insight_history($userId, $p['dataset_id'], $target);

    $out = sprintf("**Business insights — %s**\n\n", $p['name']);

    // 1. Where the forecast sits against what actually happened.
    $fcAvg = array_sum($values) / count($values);
    if ($history) {
        $recent = array_slice($history, -min(12, count($history)));
        $histAvg = array_sum($recent) / count($recent);
        if ($histAvg != 0.0) {
            $delta = (($fcAvg - $histAvg) / abs($histAvg)) * 100;
            $out .= sprintf("**Direction.** Your forecast averages %s per %s, against %s across your recent history — %s of %.1f%%.\n\n",
                number_format($fcAvg, 2), $period, number_format($histAvg, 2),
                $delta >= 0 ? 'an increase' : 'a decrease', abs($delta));

            // Explain WHY the forecast changes
            $out .= insight_why_analysis($history, $values) . "\n\n";

            // Growth-specific advice
            $out .= insight_growth_advice($delta, $target) . "\n\n";
        }
    } else {
        $out .= sprintf("**Direction.** Your forecast averages %s per %s over the next %d.\n\n",
            number_format($fcAvg, 2), $period, count($values));
    }

    // 2. Peaks and troughs drive capacity, staffing and stock decisions.
    $maxI = array_keys($values, max($values))[0];
    $minI = array_keys($values, min($values))[0];
    $swing = max($values) != 0.0 ? ((max($values) - min($values)) / abs(max($values))) * 100 : 0.0;

    if ($swing >= 5 && $maxI !== $minI) {
        $out .= sprintf("**Peak and trough.** The high point lands at **%s** (%s) and the low at **%s** (%s) — a swing of %.1f%%.\n",
            $labels[$maxI] ?: "period " . ($maxI + 1), number_format($values[$maxI], 2),
            $labels[$minI] ?: "period " . ($minI + 1), number_format($values[$minI], 2), $swing);
        $out .= $swing > 25
            ? sprintf("That's a pronounced cycle. Plan capacity, stock and staffing around the peak rather than the average, or you'll be short when it arrives — and avoid carrying that same cost through the trough.\n\n")
            : sprintf("That's a moderate cycle, worth smoothing with a modest buffer ahead of the peak rather than a major change in plan.\n\n");
    } else {
        $out .= "**Stability.** The forecast is fairly level across the window, with no pronounced peak or trough. Steady-state planning is reasonable here.\n\n";
    }

    // 3. Volatility in the history is the honest guide to how much buffer to hold.
    if ($history && count($history) >= 4) {
        $hAvg = array_sum($history) / count($history);
        if ($hAvg != 0.0) {
            $var = array_sum(array_map(fn($v) => ($v - $hAvg) ** 2, $history)) / count($history);
            $cv = (sqrt($var) / abs($hAvg)) * 100;
            $out .= sprintf("**Variability.** Historically this series swings about %.1f%% around its own average. ", $cv);
            $out .= $cv > 30
                ? "That's high, so treat any single forecast figure as the middle of a wide range and hold a real buffer against it.\n\n"
                : ($cv > 12
                    ? "That's moderate — a modest contingency on top of the forecast should absorb normal fluctuation.\n\n"
                    : "That's low, so the series is fairly predictable and you can plan close to the forecast.\n\n");
        }
    }

    // 4. How much confidence the advice deserves.
    $lastPoint = end($points);
    $lo = (float)($lastPoint['low'] ?? 0);
    $hi = (float)($lastPoint['high'] ?? 0);
    $lastVal = (float)($lastPoint['value'] ?? 0);
    $band = ($hi > $lo && $lastVal != 0.0) ? (($hi - $lo) / abs($lastVal)) * 100 : 0.0;

    $out .= "**How far to trust this.** ";
    if ($accuracy === null) {
        $out .= "This run wasn't scored, so treat it as indicative only.";
    } elseif ($accuracy >= 85) {
        $out .= sprintf("The model scored %.2f%% on held-out history, which is solid — reasonable to plan against.", $accuracy);
    } elseif ($accuracy >= 70) {
        $out .= sprintf("The model scored %.2f%%, so the direction is more reliable than the exact figures. Use it to decide *whether* to act, not to commit to a precise number.", $accuracy);
    } else {
        $out .= sprintf("The model only scored %.2f%%, which is weak. Treat this as a rough signal and gather more history before making a costly decision on it.", $accuracy);
    }
    if ($band > 0) {
        $out .= sprintf(" By the end of the window the range widens to about %.1f%% of the projected value, so later periods carry noticeably more uncertainty than the near term.", $band);
    }

    return $out;
}

// Reads the numeric series the forecast was trained on, so advice can compare
// the projection against what actually happened.
function insight_history(string $userId, ?string $datasetId, string $target): array {
    if (!$datasetId) return [];
    $stmt = db()->prepare('SELECT `rows` FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    $row = $stmt->fetch();
    if (!$row) return [];

    $rows = json_decode($row['rows'], true) ?: [];
    $series = [];
    foreach ($rows as $r) {
        if (!array_key_exists($target, $r)) continue;
        $v = $r[$target];
        if (is_numeric($v)) $series[] = (float)$v;
    }
    return $series;
}

/**
 * Analyzes what is driving the forecast by examining patterns in history.
 * Identifies trend, seasonality, and momentum.
 */
function insight_why_analysis(array $history, array $forecast): string {
    if (count($history) < 3) return "**What's driving this:** Limited history makes patterns hard to spot.";

    // Calculate trend
    $recent = array_slice($history, -min(12, count($history)));
    $older = array_slice($history, 0, max(1, count($history) - 12));
    $recentAvg = array_sum($recent) / count($recent);
    $olderAvg = $older ? (array_sum($older) / count($older)) : $recentAvg;
    $trend = $olderAvg != 0.0 ? (($recentAvg - $olderAvg) / abs($olderAvg)) * 100 : 0;

    // Calculate momentum (rate of change in recent periods)
    $momentum = 0;
    if (count($recent) >= 2) {
        $first = $recent[0];
        $last = $recent[count($recent) - 1];
        if ($first != 0.0) {
            $momentum = (($last - $first) / abs($first)) * 100;
        }
    }

    // Detect seasonality/cycles
    if (count($history) >= 8) {
        $max = max($history);
        $min = min($history);
        $range = $max != 0.0 ? (($max - $min) / abs($max)) * 100 : 0;
        $hasCycle = $range > 15;
    } else {
        $hasCycle = false;
    }

    $out = "**What's driving this:** ";

    // Build explanation
    $signals = [];

    if (abs($trend) >= 20) {
        $dir = $trend > 0 ? "accelerating" : "decelerating";
        $signals[] = "Strong $dir trend in your recent 12 months (" . number_format($trend, 1) . "%)";
    } elseif (abs($trend) >= 8) {
        $dir = $trend > 0 ? "rising" : "falling";
        $signals[] = "Consistent $dir trend in recent months (" . number_format($trend, 1) . "%)";
    }

    if (abs($momentum) >= 15 && count($recent) >= 4) {
        $dir = $momentum > 0 ? "accelerating" : "decelerating";
        $signals[] = "Momentum is $dir (last quarter moved " . number_format($momentum, 1) . "%)";
    }

    if ($hasCycle) {
        $signals[] = "Regular seasonal patterns are repeating in the forecast";
    }

    if (empty($signals)) {
        $out .= "The model is reading the average from your recent history without major trend or seasonality — it's essentially projecting stability.";
    } else {
        $out .= implode("; ", $signals) . ".";
    }

    return $out;
}

function insight_growth_advice(float $deltaPct, string $target): string {
    if ($deltaPct >= 25) {
        return sprintf(
            "**Why it matters:** That's steep growth. The model is detecting sustained upward momentum from your recent history.\n\n" .
            "**Business impact:** Check that whatever delivers %s can actually scale that far — supply, headcount, infrastructure, cash flow — because a forecast like this fails in practice when capacity, not demand, becomes the constraint.\n\n" .
            "**What to do now:** 1) Stress-test your supply chain and headcount plan against this level. 2) Front-load hiring and vendor commitments to be ready 4-6 months ahead. 3) Secure working capital if the growth requires it.", $target
        );
    }
    if ($deltaPct >= 8) {
        return sprintf(
            "**Why it matters:** That's healthy growth. The model is seeing consistent upward momentum without anomalies or reversals.\n\n" .
            "**Business impact:** Revenue and headcount can grow together, but capital and inventory will tighten if you don't plan ahead.\n\n" .
            "**What to do now:** 1) Plan capacity 10-15%% ahead of the forecast to stay ahead of demand. 2) Lock in vendor commitments now if lead times are long. 3) Monitor early %s carefully — if reality lags forecast, pull back on hiring.", $target
        );
    }
    if ($deltaPct > -8) {
        return sprintf(
            "**Why it matters:** That's broadly flat. The model is seeing consistent performance without trend in either direction.\n\n" .
            "**Business impact:** Current plans are probably about right. There's less urgency to shift headcount or capital spend.\n\n" .
            "**What to do now:** 1) Review committed costs to confirm they're sized for this level. 2) Use this as breathing room to optimize existing operations rather than chase growth. 3) Watch for early signs of trend reversals in the next 6-8 weeks."
        );
    }
    if ($deltaPct > -25) {
        return sprintf(
            "**Why it matters:** That's a meaningful decline. The model is detecting a sustained downward trend from recent months.\n\n" .
            "**Business impact:** If this holds, revenue will drop 8-25%%. Fixed costs and headcount will become burdensome. Profit will compress faster than %s falls.\n\n" .
            "**What to do now:** 1) Understand the cause — is this seasonal, competitive, or structural? 2) Right-size fixed costs now; delay never helps. 3) Review pricing, product mix or customer concentration to understand why.", $target
        );
    }
    return sprintf(
        "**Why it matters:** That's a sharp drop. The model is detecting a sharp reversal or collapse from recent performance.\n\n" .
        "**Business impact:** Plans built on current %s levels will overshoot badly. You risk obsolete inventory, stranded staff, and cash burn. This is the expensive kind of forecast to get wrong.\n\n" .
        "**What to do now:** 1) Verify the data — is this a real signal or a data issue? 2) Investigate the cause immediately — lost customer, market shift, or campaign failure? 3) Pause non-essential spend and hiring until you're confident in the direction.", $target
    );
}

// --- Intent handlers -------------------------------------------------------

function answer_accuracy(callable $q): string {
    $row = $q('SELECT COUNT(*) n, AVG(accuracy) avg_a, MAX(accuracy) max_a, MIN(accuracy) min_a
               FROM predictions WHERE user_id = :uid AND accuracy IS NOT NULL')->fetch();

    if (!$row['n']) {
        return "None of your forecasts have an accuracy score yet.\n\n" .
               "Accuracy is worked out when a model is trained: the service holds back part of your history, " .
               "predicts it, and compares the prediction against what actually happened. Run a forecast from the " .
               "Predictions page and I'll be able to tell you how trustworthy it is.";
    }

    $n = (int)$row['n'];
    $avg = (float)$row['avg_a'];
    $best = $q('SELECT name, accuracy, target FROM predictions
                WHERE user_id = :uid AND accuracy IS NOT NULL ORDER BY accuracy DESC LIMIT 1')->fetch();
    $worst = $q('SELECT name, accuracy, target FROM predictions
                 WHERE user_id = :uid AND accuracy IS NOT NULL ORDER BY accuracy ASC LIMIT 1')->fetch();

    $out = sprintf(
        "Across %d scored forecast%s your average accuracy is **%.2f%%**.\n\n%s\n\n",
        $n, $n === 1 ? '' : 's', $avg, accuracy_verdict($avg)
    );

    if ($n === 1) {
        $out .= sprintf("That's from a single run, **%s**, so treat it as a first reading rather than a track record. " .
                        "Run a few more forecasts and I can tell you whether the model is consistently reliable.", $best['name']);
        return $out;
    }

    $spread = (float)$row['max_a'] - (float)$row['min_a'];

    // Naming a "best" and "worst" is meaningless when every run scored the
    // same — which happens when they are re-runs of one series.
    if ($spread < 0.01) {
        return $out . sprintf(
            "Every run scored the same %.2f%%, which means they're repeat forecasts of the same series rather than " .
            "genuinely different models. Forecast a second column or a different dataset and I can start comparing them.",
            $avg
        );
    }

    $out .= sprintf(
        "• Best: **%s** at %.2f%%\n• Weakest: **%s** at %.2f%%\n• Spread: %.2f points\n\n",
        $best['name'], $best['accuracy'], $worst['name'], $worst['accuracy'], $spread
    );
    $out .= $spread > 15
        ? "That's a wide spread, which usually means some of your series are much noisier or shorter than others. " .
          "The weaker runs are worth a look — more history, or a coarser period like monthly instead of daily, often helps."
        : "The runs are clustered fairly tightly, which suggests the model behaves consistently across your data.";
    return $out;
}

// Accuracy here is 100 − MAPE, so it reads as "how close predictions landed
// to reality on held-out history".
function accuracy_verdict(float $accuracy): string {
    if ($accuracy >= 95) return "That is very strong — predictions land within a few percent of actual values. Forecasts at this level are safe to plan against.";
    if ($accuracy >= 85) return "That is a solid result. The model is capturing the underlying trend and seasonality well enough to plan against, with some room for error at the edges.";
    if ($accuracy >= 70) return "That is usable but not tight. The broad direction is likely right, though individual figures could be off by a noticeable margin — treat them as a guide rather than a commitment.";
    if ($accuracy >= 50) return "That is weak. The forecast may capture rough direction but little more. More history, or a coarser period, would usually help.";
    return "That is poor — the model is struggling to find a pattern. This often means the series is too short, too irregular, or genuinely close to random.";
}

function answer_latest_forecast(callable $q): string {
    $p = $q('SELECT name, target, algorithm, accuracy, horizon, period, forecast, created_at
             FROM predictions WHERE user_id = :uid ORDER BY created_at DESC LIMIT 1')->fetch();
    if (!$p) {
        return "You haven't run any forecasts yet.\n\n" .
               "Import a dataset on the Dataset page, then open Predictions, pick the column you want to project " .
               "and Aurai will train a Prophet model on it.";
    }

    $points = json_decode($p['forecast'], true) ?: [];
    $out = sprintf(
        "Your most recent forecast is **%s**, run on %s.\n\n" .
        "It projects **%s** forward %d %s using %s%s.\n\n",
        $p['name'],
        date('j M Y', strtotime($p['created_at'])),
        $p['target'] ?: 'the target column',
        (int)$p['horizon'],
        strtolower($p['period'] ?: 'periods'),
        $p['algorithm'] ?: 'Prophet',
        $p['accuracy'] !== null ? sprintf(', scoring %.2f%% accuracy', $p['accuracy']) : ' (not scored)'
    );

    if (!$points) return $out . "The stored forecast has no data points, which suggests the run did not complete.";

    $first = (float)($points[0]['value'] ?? 0);
    $lastPoint = end($points);
    $last = (float)($lastPoint['value'] ?? 0);
    $change = $last - $first;
    $pct = $first != 0.0 ? ($change / abs($first)) * 100 : 0.0;

    $direction = abs($pct) < 1 ? 'essentially flat' : ($change > 0 ? 'rising' : 'falling');
    $out .= sprintf(
        "**What it says:** the series is %s over the forecast window — from about %s at %s to %s by %s",
        $direction,
        number_format($first, 2),
        $points[0]['label'] ?? 'the start',
        number_format($last, 2),
        $lastPoint['label'] ?? 'the end'
    );
    $out .= abs($pct) < 1
        ? ".\n\n"
        : sprintf(", a change of %s%.1f%%.\n\n", $change > 0 ? '+' : '', $pct);

    // Band width relative to the value is the clearest read on confidence.
    $lo = (float)($lastPoint['low'] ?? $last);
    $hi = (float)($lastPoint['high'] ?? $last);
    $bandPct = $last != 0.0 ? (($hi - $lo) / abs($last)) * 100 : 0.0;

    if ($hi > $lo) {
        $out .= sprintf(
            "**How confident:** by the end of the window the model's range is %s to %s — about %.1f%% wide. ",
            number_format($lo, 2), number_format($hi, 2), $bandPct
        );
        $out .= $bandPct > 30
            ? "That's a wide band, so treat the far end of this forecast as a rough direction rather than a number to plan on."
            : ($bandPct > 10
                ? "That's a moderate band — the near-term figures are firmer than the later ones."
                : "That's a tight band, meaning the model found a clear, consistent pattern.");
    } else {
        $out .= "**How confident:** the model reports effectively no uncertainty, which usually means the input series is almost perfectly regular.";
    }

    return $out;
}

function answer_datasets(callable $q): string {
    $rows = $q('SELECT name, JSON_LENGTH(`rows`) n, meta, created_at FROM datasets
                WHERE user_id = :uid ORDER BY created_at DESC')->fetchAll();
    if (!$rows) {
        return "You don't have any datasets yet.\n\n" .
               "Head to the Dataset page and drop in a CSV or JSON file. It needs a date column and at least one " .
               "numeric column — that's all Prophet needs to learn a pattern. Thirty or more rows gives it enough " .
               "history to pick up seasonality.";
    }

    $total = array_sum(array_map(fn($r) => (int)$r['n'], $rows));
    $out = sprintf("You have **%d** dataset%s holding %s rows in total.\n\n",
        count($rows), count($rows) === 1 ? '' : 's', number_format($total));

    foreach (array_slice($rows, 0, 8) as $r) {
        $meta = json_decode($r['meta'] ?? '{}', true);
        $headers = $meta['headers'] ?? [];
        $out .= sprintf("• **%s** — %s rows", $r['name'], number_format((int)$r['n']));
        if ($headers) {
            $out .= sprintf(", %d columns (%s)", count($headers), implode(', ', array_slice($headers, 0, 6)));
        }
        $out .= sprintf(", added %s\n", date('j M Y', strtotime($r['created_at'])));
    }
    if (count($rows) > 8) $out .= sprintf("\n…and %d more.", count($rows) - 8);

    $small = array_filter($rows, fn($r) => (int)$r['n'] < 24);
    if ($small) {
        $out .= sprintf("\n\nA note: %d of these %s fewer than 24 rows. Prophet can still fit them, but it needs " .
                        "roughly two cycles of history to detect seasonality, so those forecasts will lean mostly on trend.",
            count($small), count($small) === 1 ? 'has' : 'have');
    }
    return $out;
}

function answer_predictions(callable $q): string {
    $row = $q('SELECT COUNT(*) n FROM predictions WHERE user_id = :uid')->fetch();
    if (!$row['n']) {
        return "You haven't run any forecasts yet.\n\n" .
               "Open the Predictions page, choose a dataset and the column you want to project, set how far ahead " .
               "to look, and Aurai will train a Prophet model on your history. The first run takes about a minute; " .
               "after that the trained model is reused and repeat runs come back almost instantly.";
    }

    $n = (int)$row['n'];
    $recent = $q('SELECT name, algorithm, accuracy, horizon, period, created_at FROM predictions
                  WHERE user_id = :uid ORDER BY created_at DESC LIMIT 5')->fetchAll();
    $targets = $q('SELECT COUNT(DISTINCT target) t, COUNT(DISTINCT dataset_id) d
                   FROM predictions WHERE user_id = :uid')->fetch();

    $out = sprintf("You've run **%d** forecast%s, covering %d target column%s across %d dataset%s.\n\n",
        $n, $n === 1 ? '' : 's',
        (int)$targets['t'], (int)$targets['t'] === 1 ? '' : 's',
        (int)$targets['d'], (int)$targets['d'] === 1 ? '' : 's');

    $out .= "Your most recent runs:\n\n";
    foreach ($recent as $r) {
        $out .= sprintf("• **%s** — %s over %d %s%s, %s\n",
            $r['name'],
            $r['algorithm'] ?: 'Prophet',
            (int)$r['horizon'],
            strtolower($r['period'] ?: 'periods'),
            $r['accuracy'] !== null ? sprintf(', %.2f%% accuracy', $r['accuracy']) : '',
            date('j M Y', strtotime($r['created_at'])));
    }
    if ($n > 5) $out .= sprintf("\n…and %d earlier run%s.", $n - 5, $n - 5 === 1 ? '' : 's');
    $out .= "\n\nAsk me *how accurate are my models* and I'll tell you how much to trust them.";
    return $out;
}

function answer_reports(callable $q): string {
    $rows = $q('SELECT title, body, updated_at FROM reports WHERE user_id = :uid ORDER BY updated_at DESC')->fetchAll();
    if (!$rows) {
        return "You haven't written any reports yet.\n\n" .
               "The Reports page has a rich-text editor that autosaves as you type, and exports to PDF, JSON or " .
               "plain text — useful for writing up a forecast for someone who won't be opening the dashboard.";
    }

    $out = sprintf("You have **%d** report%s.\n\n", count($rows), count($rows) === 1 ? '' : 's');
    foreach (array_slice($rows, 0, 8) as $r) {
        $words = str_word_count(strip_tags((string)$r['body']));
        $out .= sprintf("• **%s** — roughly %s word%s, last edited %s\n",
            $r['title'], number_format($words), $words === 1 ? '' : 's',
            date('j M Y', strtotime($r['updated_at'])));
    }
    if (count($rows) > 8) $out .= sprintf("\n…and %d more.", count($rows) - 8);
    return $out;
}

function answer_summary(string $userId): string {
    // Native prepares can't reuse one named placeholder, so each subquery
    // gets its own.
    $stmt = db()->prepare('SELECT
              (SELECT COUNT(*) FROM datasets WHERE user_id = :u1) d,
              (SELECT COUNT(*) FROM predictions WHERE user_id = :u2) p,
              (SELECT COUNT(*) FROM reports WHERE user_id = :u3) r,
              (SELECT AVG(accuracy) FROM predictions WHERE user_id = :u4 AND accuracy IS NOT NULL) a');
    $stmt->execute([':u1' => $userId, ':u2' => $userId, ':u3' => $userId, ':u4' => $userId]);
    $c = $stmt->fetch();

    $d = (int)$c['d']; $p = (int)$c['p']; $r = (int)$c['r'];
    $out = "Here's where your workspace stands:\n\n" .
        sprintf("• **Datasets:** %d\n• **Forecasts run:** %d\n• **Reports:** %d\n• **Average accuracy:** %s\n\n",
            $d, $p, $r, $c['a'] !== null ? sprintf('%.2f%%', $c['a']) : 'nothing scored yet');

    // Point at the most useful next step for whatever state they're in.
    if ($d === 0) {
        $out .= "Nothing is loaded yet. Start by importing a CSV on the Dataset page — one date column and one " .
                "numeric column is enough to get a forecast out of it.";
    } elseif ($p === 0) {
        $out .= sprintf("You have data loaded but haven't forecast anything with it yet. Open Predictions, pick one " .
                        "of your %d dataset%s and a column to project, and Aurai will train a model on it.",
                        $d, $d === 1 ? '' : 's');
    } elseif ($c['a'] !== null && (float)$c['a'] < 70) {
        $out .= sprintf("Your average accuracy of %.2f%% is on the low side. That usually points to short or noisy " .
                        "history — more rows, or forecasting at a coarser period, tends to help most.", $c['a']);
    } elseif ($r === 0) {
        $out .= "Your forecasts are in good shape. If you need to share them with someone, the Reports page will " .
                "let you write them up and export to PDF.";
    } else {
        $out .= "Everything's in good order. Ask me *what was my latest forecast* if you want to know what it's " .
                "actually projecting.";
    }
    return $out;
}

// --- Reasoned business insights --------------------------------------------

/**
 * Business advice on one forecast, reasoned where possible.
 *
 * This is the single entry point for advice: the /insights route and the
 * assistant's "what should I do" intent both come through here, so the two
 * never drift apart in what they say. Gemini writes the analysis when it can
 * and the deterministic version answers when it cannot, which is the same
 * contract the rest of the AI layer keeps.
 *
 * @param bool  $reasoning Passing false forces the deterministic version.
 *                         Tests use it; a model rewords itself between calls,
 *                         so the built-in analysis could not otherwise be
 *                         asserted — and it is what most users see whenever
 *                         the quota is spent or the model is unreachable.
 * @param bool|null $reasoned Set to whether the model actually answered. The
 *                         caller cannot infer this from the text, and the page
 *                         says which it is showing.
 */
function business_insights(string $userId, ?string $predictionId = null, bool $reasoning = true, ?bool &$reasoned = null): string {
    $reasoned = false;
    if ($reasoning && gemini_available()) {
        $advice = insights_reasoned($userId, $predictionId);
        if ($advice !== null) {
            $reasoned = true;
            return $advice;
        }
    }
    return answer_insights($userId, $predictionId);
}

/**
 * Asks the model to read one forecast the way an adviser would.
 *
 * The prompt hands over the projection *and* the recorded history behind it,
 * because advice that never compares the two is just a restatement of the
 * forecast. Accuracy is included for the same reason the built-in version
 * hedges on it: a confident recommendation off a weak model is the one
 * failure mode that actually costs the user money.
 */
function insights_reasoned(string $userId, ?string $predictionId): ?string {
    $p = forecast_context($userId, $predictionId);
    if (!$p) return null;

    $prompt = "A forecast this user has run, with the history it was trained on:\n\n"
        . forecast_as_text($p)
        . "\n\nAdvise them on it as their analyst would, focusing on *why* the numbers move "
        . "the way they do and what's driving the changes. Cover, in this order and without labelling the sections:\n\n"
        . "1. **The verdict**: One bold line: is this growth, decline, or flat? By how much? "
        . "What does it mean for the business?\n\n"
        . "2. **Root causes**: What patterns in the history explain this direction?\n"
        . "   - Is there a sustained uptrend or downtrend the model is projecting forward?\n"
        . "   - Are there seasonal/cyclical patterns returning?\n"
        . "   - Is momentum accelerating, stable, or slowing?\n"
        . "   - What would cause this outcome (market growth, customer churn, seasonal demand, etc.)?\n\n"
        . "3. **What's driving growth or decline**: If the target is growing: what business factors (new customers, higher usage, price increases) would explain it? "
        . "If declining: what's the likely cause (competition, market saturation, cost cutting by customers)?\n\n"
        . "4. **Business impact**: Specific consequences—revenue implications, capacity needs, "
        . "competitive position. What's at stake?\n\n"
        . "5. **Timing and extremes**: Peak and trough—when they hit and what to plan for at each. "
        . "What happens if the forecast overshoots or undershoots by 10-20%?\n\n"
        . "6. **Three concrete actions**: Each tied to a specific figure or risk. What should "
        . "the business do *this month* based on this forecast?\n\n"
        . "7. **Confidence**: How much weight does the accuracy merit? What could go wrong? "
        . "What would prove the forecast wrong?\n\n"
        . "Open with your one-line verdict in bold. Be specific with numbers and dates. "
        . "Keep it under 450 words.";

    return gemini_generate(
        gemini_system_prompt(
            'You are Aurai, a seasoned business analyst advising a business leader on their '
            . 'demand forecast. Your job is to explain *why* the numbers move the way they do, '
            . 'what it means for their business, and what they should do about it. Be specific, '
            . 'tie every recommendation to a figure, and make the stakes clear.'
        ),
        $prompt,
        ['maxOutputTokens' => 1500],
    );
}

// --- The Business Insights page --------------------------------------------

/**
 * Everything the adviser page renders: the written advice, the figures behind
 * it, and the series to chart.
 *
 * The prose and the numbers are produced from the same forecast in one request
 * so they cannot disagree — a page that fetched advice and metrics separately
 * could show a verdict about one run beside the chart of another.
 *
 * History is rebuilt from the dataset rather than stored on the prediction,
 * because predictions keep only their forecast. That means the recorded series
 * always reflects the dataset as it stands now, which is the honest thing to
 * chart the projection against.
 */
function insights_page(string $userId, ?string $predictionId, bool $reasoning, bool $refresh = false): array {
    $p = forecast_context($userId, $predictionId);

    // The picker needs the full list whether or not there is anything to advise on.
    $stmt = db()->prepare(
        'SELECT id, name, accuracy, target, created_at FROM predictions
         WHERE user_id = :uid ORDER BY created_at DESC LIMIT 50'
    );
    $stmt->execute([':uid' => $userId]);
    $available = array_map(fn($r) => [
        'id' => $r['id'],
        'name' => $r['name'],
        'target' => $r['target'],
        'accuracy' => $r['accuracy'] !== null ? (float)$r['accuracy'] : null,
        'createdAt' => $r['created_at'],
    ], $stmt->fetchAll());

    if (!$p) {
        // Nothing to advise on, so nothing to store either. The advice here is
        // the prompt to go and run a forecast.
        return ['advice' => business_insights($userId, null, false), 'reasoned' => false,
                'cached' => false, 'generatedAt' => null, 'forecast' => null,
                'metrics' => null, 'history' => [], 'points' => [], 'available' => $available];
    }

    [$advice, $reasoned, $cached, $generatedAt] = insights_advice($userId, $p['id'], $reasoning, $refresh);

    return [
        'advice' => $advice,
        'reasoned' => $reasoned,
        'cached' => $cached,
        'generatedAt' => $generatedAt,
        'forecast' => [
            'id' => $p['id'],
            'name' => $p['name'],
            'target' => $p['target'],
            'period' => $p['period'],
            'horizon' => (int)$p['horizon'],
            'algorithm' => $p['algorithm'],
            'accuracy' => $p['accuracy'] !== null ? (float)$p['accuracy'] : null,
            'datasetName' => $p['datasetName'],
            'createdAt' => $p['created_at'],
        ],
        'metrics' => insights_metrics($p),
        'history' => insights_history_points($userId, $p),
        'points' => $p['forecast'],
        'available' => $available,
    ];
}

/**
 * The headline figures, each one the page shows as its own tile.
 *
 * Returns nulls rather than zeros where a figure cannot be computed — a series
 * too short to have a meaningful spread, say. A tile that renders "0.0%" for
 * "unknown" is worse than one that renders nothing, because it invites a
 * decision.
 */
function insights_metrics(array $p): array {
    $points = $p['forecast'] ?? [];
    $history = $p['history'] ?? [];
    $values = array_map(fn($x) => (float)($x['value'] ?? 0), $points);
    $labels = array_map(fn($x) => (string)($x['label'] ?? ''), $points);

    $m = [
        'historyAvg' => null, 'forecastAvg' => null, 'growthPct' => null,
        'peak' => null, 'trough' => null, 'swingPct' => null,
        'volatilityPct' => null, 'bandPct' => null,
    ];
    if (!$values) return $m;

    $m['forecastAvg'] = round(array_sum($values) / count($values), 2);

    if ($history) {
        $recent = array_slice($history, -min(12, count($history)));
        $histAvg = array_sum($recent) / count($recent);
        $m['historyAvg'] = round($histAvg, 2);
        if ($histAvg != 0.0) {
            $m['growthPct'] = round((($m['forecastAvg'] - $histAvg) / abs($histAvg)) * 100, 1);
        }
    }

    $maxI = array_keys($values, max($values))[0];
    $minI = array_keys($values, min($values))[0];
    $m['peak'] = ['label' => $labels[$maxI] ?: 'period ' . ($maxI + 1), 'value' => round($values[$maxI], 2)];
    $m['trough'] = ['label' => $labels[$minI] ?: 'period ' . ($minI + 1), 'value' => round($values[$minI], 2)];
    if (max($values) != 0.0) {
        $m['swingPct'] = round(((max($values) - min($values)) / abs(max($values))) * 100, 1);
    }

    // Coefficient of variation: how much the series has historically moved
    // around its own average, which is the honest guide to how big a buffer
    // the forecast needs. Four points is the floor for it to mean anything.
    if (count($history) >= 4) {
        $hAvg = array_sum($history) / count($history);
        if ($hAvg != 0.0) {
            $var = array_sum(array_map(fn($v) => ($v - $hAvg) ** 2, $history)) / count($history);
            $m['volatilityPct'] = round((sqrt($var) / abs($hAvg)) * 100, 1);
        }
    }

    // How wide the confidence band has grown by the end of the window — the
    // number that says how much less the far end of a forecast is worth.
    $last = end($points);
    $lo = (float)($last['low'] ?? 0);
    $hi = (float)($last['high'] ?? 0);
    $val = (float)($last['value'] ?? 0);
    if ($hi > $lo && $val != 0.0) $m['bandPct'] = round((($hi - $lo) / abs($val)) * 100, 1);

    return $m;
}

/**
 * The recorded series, labelled, so the chart can show where history ends and
 * projection begins.
 *
 * The date column is re-detected rather than stored: predictions do not record
 * which column they used, and the detection is the same one the forecast ran
 * with, so it lands on the same column for the same dataset.
 */
function insights_history_points(string $userId, array $p): array {
    if (empty($p['dataset_id']) || empty($p['target'])) return [];

    $stmt = db()->prepare('SELECT `rows` FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $p['dataset_id'], ':uid' => $userId]);
    $row = $stmt->fetch();
    if (!$row) return [];

    $rows = json_decode($row['rows'], true) ?: [];
    if (!$rows) return [];

    $headers = array_keys($rows[0]);
    $dateColumn = guess_date_column($rows, $headers, $p['target']);
    if (!$dateColumn) return [];

    return history_points($rows, $dateColumn, $p['target']);
}

/**
 * The stored advice for a forecast, generating it only when there is none.
 *
 * A saved forecast never changes — its points and its accuracy are fixed at
 * the moment it was run — so advice about it does not go stale and there is
 * nothing to expire. Regenerating on every page view would simply spend the
 * daily model quota re-deriving the same answer, and leave the user watching a
 * spinner for something they had already read.
 *
 * Only a deliberate refresh overwrites the stored copy, and only when the new
 * attempt actually produced something: a failed regeneration must not replace
 * good advice with the fallback.
 *
 * @return array{0:string,1:bool,2:bool,3:?string} advice, reasoned, served from
 *         store, when it was written
 */
function insights_advice(string $userId, string $predictionId, bool $reasoning, bool $refresh): array {
    $stmt = db()->prepare('SELECT advice, reasoned, created_at FROM insights
                           WHERE prediction_id = :pid AND user_id = :uid');
    $stmt->execute([':pid' => $predictionId, ':uid' => $userId]);
    $stored = $stmt->fetch();

    if ($stored && !$refresh) {
        return [$stored['advice'], (bool)$stored['reasoned'], true, $stored['created_at']];
    }

    $advice = business_insights($userId, $predictionId, $reasoning, $reasoned);

    // On a refresh that fell back to the template, keep what was already
    // written: a model answer the user has read is worth more than a fresh
    // template that replaces it because the quota happened to be spent.
    if ($stored && !$reasoned && $stored['reasoned']) {
        return [$stored['advice'], true, true, $stored['created_at']];
    }

    $stmt = db()->prepare(
        'INSERT INTO insights (prediction_id, user_id, advice, reasoned)
         VALUES (:pid, :uid, :advice, :reasoned)
         ON DUPLICATE KEY UPDATE advice = VALUES(advice), reasoned = VALUES(reasoned),
                                 created_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':pid' => $predictionId, ':uid' => $userId,
        ':advice' => $advice, ':reasoned' => $reasoned ? 1 : 0,
    ]);

    return [$advice, $reasoned, false, date('Y-m-d H:i:s')];
}
