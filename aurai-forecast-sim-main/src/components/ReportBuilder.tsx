import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiDownload, FiAlertCircle, FiCheck } from 'react-icons/fi';
import { GlassCard } from '@/components/GlassCard';
import { generateReportFromPrediction } from '@/lib/reportGenerator';
import { listAnomalies, listScenarios } from '@/lib/db';

export function ReportBuilder({ prediction, chartRef, insights, isOpen, onClose }: any) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleGenerateReport = async () => {
    if (!prediction) return;

    setGenerating(true);
    setError('');
    setSuccess(false);

    try {
      // Best-effort — a report with no recorded anomalies or saved
      // scenarios yet is still complete, just without those sections.
      const [anomalies, scenarios] = prediction.id
        ? await Promise.all([
            listAnomalies(prediction.id).catch(() => []),
            listScenarios(prediction.id).catch(() => []),
          ])
        : [[], []];

      await generateReportFromPrediction(prediction, chartRef?.current, insights, {
        anomalies,
        scenarios: (scenarios || []).map((s: any) => ({
          name: s.name,
          metrics: s.results && typeof s.results === 'object' && 'adjustedTotal' in s.results ? s.results : null,
        })),
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 2000);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate report');
      console.error('Report generation error:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

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
        className="max-w-md w-full"
      >
        <GlassCard>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FiDownload className="w-5 h-5" />
                Generate Executive Report
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Package this forecast with AI insights, metrics, and chart into a professional PDF.
              </p>
            </div>

            <div className="space-y-2 py-3 border-y border-border/50">
              <div className="text-sm">
                <p className="font-medium text-foreground">{prediction?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {prediction?.target} • {prediction?.algorithm} • {prediction?.horizon}{' '}
                  {prediction?.period}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-chart-1 mt-0.5">✓</span>
                <span>Forecast chart with confidence bands</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-chart-1 mt-0.5">✓</span>
                <span>AI assistant commentary and business advice</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-chart-1 mt-0.5">✓</span>
                <span>Accuracy, volatility, and confidence metrics</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-chart-1 mt-0.5">✓</span>
                <span>Professional formatting for stakeholders</span>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-rose-500/20 border border-rose-500/30 rounded-lg p-3 flex items-start gap-2"
                >
                  <FiAlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-rose-300">{error}</p>
                </motion.div>
              )}

              {success && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-3 flex items-start gap-2"
                >
                  <FiCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-emerald-300">Report generated and downloaded!</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={generating}
                className="flex-1 px-4 py-2 rounded-lg border border-border/50 bg-background/50 hover:bg-background/80 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateReport}
                disabled={generating || !prediction}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-chart-1 to-chart-3 hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium text-white flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4"
                    >
                      ⟳
                    </motion.div>
                    Generating...
                  </>
                ) : (
                  <>
                    <FiDownload className="w-4 h-4" />
                    Generate PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
