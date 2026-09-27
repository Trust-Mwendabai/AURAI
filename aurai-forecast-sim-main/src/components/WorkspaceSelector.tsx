import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiChevronDown, FiPlus, FiSettings } from 'react-icons/fi';
import { api } from '@/lib/apiClient';

export function WorkspaceSelector({ currentWorkspace, onSelectWorkspace, onCreateWorkspace }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useState<HTMLDivElement | null>(null)[1];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Find the workspace selector container
      const container = document.querySelector('[data-workspace-selector]');
      if (container && !container.contains(target)) {
        setIsOpen(false);
      }
    };

    // Add slight delay to prevent immediate close
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const data = await api.get('/workspaces');
      setWorkspaces(data);
    } catch (e) {
      console.error('Failed to load workspaces:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectWorkspace = (workspace: any) => {
    onSelectWorkspace(workspace);
    setIsOpen(false);
  };

  return (
    <div className="relative" data-workspace-selector>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-sm font-medium"
      >
        <div className="w-2 h-2 rounded-full bg-chart-1" />
        <span className="max-w-[150px] truncate">{currentWorkspace?.name || 'No Workspace'}</span>
        <FiChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-full left-0 mt-2 w-64 z-50"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="rounded-lg border border-border bg-background/95 backdrop-blur-sm p-2 shadow-lg">
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  Loading workspaces...
                </div>
              ) : workspaces.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  No workspaces yet
                </div>
              ) : (
                workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      currentWorkspace?.id === ws.id
                        ? 'bg-primary/20 text-primary font-medium'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{ws.name}</div>
                        {ws.member_count && (
                          <div className="text-xs text-muted-foreground">
                            {ws.member_count} member{ws.member_count !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                      {ws.role && (
                        <span className="text-[10px] font-semibold text-muted-foreground ml-2 whitespace-nowrap">
                          {ws.role}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-border/50 mt-2 pt-2 space-y-1">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onCreateWorkspace();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-sm text-foreground/70 hover:text-foreground"
              >
                <FiPlus className="w-4 h-4" />
                New workspace
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-sm text-foreground/70 hover:text-foreground"
              >
                <FiSettings className="w-4 h-4" />
                Workspace settings
              </button>
            </div>
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
