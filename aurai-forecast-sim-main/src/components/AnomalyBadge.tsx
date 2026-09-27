import { motion } from 'framer-motion';
import { FiAlertTriangle, FiAlertCircle, FiTrendingDown } from 'react-icons/fi';

interface AnomalyProps {
  count: number;
  severityLevel: 'low' | 'medium' | 'high';
  onClick?: () => void;
}

export function AnomalyBadge({ count, severityLevel = 'medium', onClick }: AnomalyProps) {
  const config = {
    low: {
      bg: 'bg-amber-500/15',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      icon: FiAlertCircle,
      label: 'Anomalies detected',
    },
    medium: {
      bg: 'bg-orange-500/15',
      border: 'border-orange-500/30',
      text: 'text-orange-400',
      icon: FiAlertTriangle,
      label: 'Significant anomalies',
    },
    high: {
      bg: 'bg-rose-500/15',
      border: 'border-rose-500/30',
      text: 'text-rose-400',
      icon: FiTrendingDown,
      label: 'Critical anomalies',
    },
  };

  const style = config[severityLevel];
  const Icon = style.icon;

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${style.bg} ${style.border} ${style.text} hover:opacity-80`}
    >
      <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
        <Icon className="w-4 h-4" />
      </motion.div>
      <span className="text-xs font-semibold">{count} {style.label}</span>
    </motion.button>
  );
}

export function AnomalyList({ anomalies, onAcknowledge }: any) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="text-sm text-muted-foreground">✓ No anomalies detected</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {anomalies.map((anomaly: any) => {
        const deviation = Math.abs(anomaly.deviation_sigma);
        const severity =
          deviation > 3 ? 'high' : deviation > 2 ? 'medium' : 'low';
        const isAbove = anomaly.anomaly_type === 'above_upper';

        return (
          <motion.div
            key={anomaly.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`p-3 rounded-lg border ${
              severity === 'high'
                ? 'bg-rose-500/10 border-rose-500/20'
                : severity === 'medium'
                  ? 'bg-orange-500/10 border-orange-500/20'
                  : 'bg-amber-500/10 border-amber-500/20'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {anomaly.date}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      isAbove ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isAbove ? '↑' : '↓'} {Math.abs(anomaly.actual_value - anomaly.forecasted_value).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Actual: {anomaly.actual_value.toLocaleString()} vs Forecast: {anomaly.forecasted_value.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  Deviation: {deviation.toFixed(1)}σ
                </div>
                {anomaly.note && (
                  <div className="text-xs text-foreground/70 mt-1.5 italic">
                    "{anomaly.note}"
                  </div>
                )}
              </div>
              <button
                onClick={() => onAcknowledge?.(anomaly.id)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  anomaly.acknowledged
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-foreground/10 text-foreground/70 hover:bg-foreground/20'
                }`}
              >
                {anomaly.acknowledged ? '✓ Seen' : 'Acknowledge'}
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
