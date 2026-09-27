import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiPlus, FiTrash2, FiPlayCircle } from 'react-icons/fi';
import { GlassCard } from '@/components/GlassCard';
import { useToast } from '@/contexts/ToastContext';

export function ScenarioBuilder({ isOpen, onClose, forecast, onSave }: any) {
  const [scenarioName, setScenarioName] = useState('');
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { success, info } = useToast();

  if (!isOpen) return null;

  const addAdjustment = () => {
    setAdjustments([
      ...adjustments,
      { period: 0, value: 0, reason: '' },
    ]);
  };

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== index));
  };

  const updateAdjustment = (index: number, field: string, value: any) => {
    const updated = [...adjustments];
    updated[index][field] = value;
    setAdjustments(updated);
  };

  const calculateResults = () => {
    if (!forecast || !Array.isArray(forecast)) {
      info('No forecast data available');
      return;
    }

    setLoading(true);

    try {
      // Apply adjustments to forecast
      const adjusted = [...forecast];
      adjustments.forEach((adj) => {
        if (adj.period >= 0 && adj.period < adjusted.length) {
          adjusted[adj.period] = {
            ...adjusted[adj.period],
            value: Number(adj.value),
          };
        }
      });

      // Calculate results
      const values = adjusted.map((p) => Number(p.value));
      const total = values.reduce((a, b) => a + b, 0);
      const average = total / values.length;
      const peak = Math.max(...values);
      const trough = Math.min(...values);

      // Growth rate
      const growthRate = values.length > 1 && values[0] !== 0
        ? ((values[values.length - 1] - values[0]) / values[0]) * 100
        : 0;

      // Standard deviation
      const variance = values.reduce((sum, v) => sum + Math.pow(v - average, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      const result = {
        total: Math.round(total * 100) / 100,
        average: Math.round(average * 100) / 100,
        peak: Math.round(peak * 100) / 100,
        trough: Math.round(trough * 100) / 100,
        growth_rate: Math.round(growthRate * 100) / 100,
        std_dev: Math.round(stdDev * 100) / 100,
      };

      setResults(result);
      success('Scenario calculated', 'Updated results shown below');
    } catch (e: any) {
      info('Error calculating results', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!scenarioName.trim()) {
      info('Please enter a scenario name');
      return;
    }

    if (!results) {
      info('Please calculate results first');
      return;
    }

    onSave({
      name: scenarioName,
      adjustments,
      results,
    });

    setScenarioName('');
    setAdjustments([]);
    setResults(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <GlassCard>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">What-If Scenario</h3>
              <button
                onClick={onClose}
                className="p-1 hover:bg-muted/50 rounded-lg transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                Scenario Name
              </label>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="e.g., Aggressive Marketing, Market Downturn"
                className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Adjustments
                </label>
                <button
                  onClick={addAdjustment}
                  className="flex items-center gap-1 text-xs font-medium text-chart-1 hover:opacity-70 transition-opacity"
                >
                  <FiPlus className="w-3 h-3" />
                  Add adjustment
                </button>
              </div>

              <div className="space-y-2">
                {adjustments.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6">
                    No adjustments yet. Click "Add adjustment" to start.
                  </div>
                ) : (
                  adjustments.map((adj, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2 items-start p-2 bg-muted/20 rounded-lg"
                    >
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1">Period</label>
                          <input
                            type="number"
                            min="0"
                            value={adj.period}
                            onChange={(e) => updateAdjustment(i, 'period', parseInt(e.target.value))}
                            className="w-full px-2 py-1 rounded text-sm border border-border/30 bg-background/50"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1">New Value</label>
                          <input
                            type="number"
                            value={adj.value}
                            onChange={(e) => updateAdjustment(i, 'value', parseFloat(e.target.value))}
                            className="w-full px-2 py-1 rounded text-sm border border-border/30 bg-background/50"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1">Reason</label>
                          <input
                            type="text"
                            value={adj.reason}
                            onChange={(e) => updateAdjustment(i, 'reason', e.target.value)}
                            placeholder="e.g., Marketing campaign"
                            className="w-full px-2 py-1 rounded text-sm border border-border/30 bg-background/50 placeholder:text-muted-foreground/50"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeAdjustment(i)}
                        className="p-1 hover:bg-rose-500/20 rounded text-rose-400 transition-colors mt-5"
                      >
                        <FiTrash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {results && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-3 bg-gradient-to-r from-chart-1/10 to-chart-3/10 border border-chart-1/20 rounded-lg"
              >
                <div className="text-xs font-semibold text-foreground mb-2">Scenario Results</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Total</div>
                    <div className="text-sm font-semibold text-chart-1">
                      {results.total.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Average</div>
                    <div className="text-sm font-semibold">
                      {results.average.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Growth</div>
                    <div
                      className={`text-sm font-semibold ${
                        results.growth_rate >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {results.growth_rate >= 0 ? '+' : ''}{results.growth_rate}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Peak</div>
                    <div className="text-sm font-semibold">{results.peak.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Trough</div>
                    <div className="text-sm font-semibold">{results.trough.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Volatility</div>
                    <div className="text-sm font-semibold">{results.std_dev.toFixed(1)}</div>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-border/50 bg-background/50 hover:bg-background/80 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={calculateResults}
                disabled={adjustments.length === 0 || loading}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium text-white flex items-center justify-center gap-2"
              >
                {loading ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-4 h-4"
                  >
                    ⟳
                  </motion.div>
                ) : (
                  <FiPlayCircle className="w-4 h-4" />
                )}
                Calculate Results
              </button>
              <button
                onClick={handleSave}
                disabled={!results}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-chart-1 to-chart-3 hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium text-white"
              >
                Save Scenario
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
