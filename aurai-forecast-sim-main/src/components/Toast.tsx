import { motion, AnimatePresence } from "framer-motion";
import { FiCheck, FiAlertCircle, FiInfo, FiX, FiAlertTriangle } from "react-icons/fi";
import { useToast } from "@/contexts/ToastContext";

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  const getIcon = (type: string) => {
    switch (type) {
      case "success":
        return <FiCheck className="h-5 w-5 text-emerald-400" />;
      case "error":
        return <FiAlertCircle className="h-5 w-5 text-rose-400" />;
      case "warning":
        return <FiAlertTriangle className="h-5 w-5 text-amber-400" />;
      case "info":
      default:
        return <FiInfo className="h-5 w-5 text-blue-400" />;
    }
  };

  const getStyles = (type: string) => {
    switch (type) {
      case "success":
        return "bg-emerald-500/15 border-emerald-500/30";
      case "error":
        return "bg-rose-500/15 border-rose-500/30";
      case "warning":
        return "bg-amber-500/15 border-amber-500/30";
      case "info":
      default:
        return "bg-blue-500/15 border-blue-500/30";
    }
  };

  return (
    <div className="fixed bottom-24 md:bottom-4 left-4 right-4 md:right-auto md:max-w-sm z-50 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, x: 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="mb-3"
          >
            <div
              className={`glass-strong rounded-lg p-4 border pointer-events-auto ${getStyles(
                toast.type
              )}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{getIcon(toast.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-foreground">
                    {toast.title}
                  </div>
                  {toast.message && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {toast.message}
                    </div>
                  )}
                  {toast.action && (
                    <button
                      onClick={() => {
                        toast.action?.onClick();
                        removeToast(toast.id);
                      }}
                      className="text-xs font-medium mt-2 text-primary hover:text-primary/80 transition-colors"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                  aria-label="Dismiss"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
