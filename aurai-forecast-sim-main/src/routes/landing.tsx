import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { FiArrowRight, FiZap, FiTrendingUp, FiBarChart2, FiTarget, FiFileText, FiUsers, FiAlertTriangle, FiUploadCloud, FiActivity, FiShare2 } from 'react-icons/fi';
import { ThemeToggle } from '@/components/ThemeToggle';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8 } },
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-background/80">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-border/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg grid place-items-center text-white" style={{ background: 'var(--gradient-primary)' }}>
              <FiZap className="h-4 w-4" />
            </div>
            <span className="font-semibold text-lg">Aurai</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white glow"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="text-center space-y-6"
        >
          <motion.h1
            variants={itemVariants}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight"
          >
            AI-Powered Time Series
            <br />
            <span style={{ background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Forecasting Made Simple
            </span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto"
          >
            Predict future trends with confidence. Built for teams that need accurate forecasts, collaborative insights, and actionable business intelligence.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row gap-4 justify-center pt-4"
          >
            <Link
              to="/login"
              className="px-8 py-3 rounded-lg text-base font-semibold text-white glow inline-flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Get Started <FiArrowRight className="h-4 w-4" />
            </Link>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-8 py-3 rounded-lg text-base font-semibold border border-border/50 hover:bg-muted/50 transition-colors inline-flex items-center justify-center gap-2"
            >
              Learn More
            </button>
          </motion.div>
        </motion.div>

        {/* Demo Indicator */}
        <motion.div
          variants={itemVariants}
          className="mt-16 text-center text-sm text-muted-foreground"
        >
          <p>Try our demo account: <span className="font-mono text-foreground">admin@aurai.local</span> / <span className="font-mono text-foreground">aurai1234</span></p>
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border/50">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="space-y-12"
        >
          <div className="text-center space-y-4">
            <motion.h2
              variants={itemVariants}
              className="text-3xl sm:text-4xl font-bold"
            >
              Powerful Features for Modern Teams
            </motion.h2>
            <motion.p
              variants={itemVariants}
              className="text-lg text-muted-foreground max-w-2xl mx-auto"
            >
              Everything you need to forecast, collaborate, and make data-driven decisions
            </motion.p>
          </div>

          <motion.div
            variants={containerVariants}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* Feature 1 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-1)', opacity: 0.2 }}>
                <FiTrendingUp className="h-6 w-6" style={{ color: 'var(--chart-1)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Accurate Forecasts</h3>
              <p className="text-muted-foreground">
                Prophet-powered predictions with confidence intervals. Backtested accuracy scoring ensures you can trust your forecasts.
              </p>
            </motion.div>

            {/* Feature 2 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-2)', opacity: 0.2 }}>
                <FiUsers className="h-6 w-6" style={{ color: 'var(--chart-2)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Team Collaboration</h3>
              <p className="text-muted-foreground">
                Shared workspaces with role-based access. Invite team members and collaborate on forecasts in real-time.
              </p>
            </motion.div>

            {/* Feature 3 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-3)', opacity: 0.2 }}>
                <FiAlertTriangle className="h-6 w-6" style={{ color: 'var(--chart-3)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Anomaly Detection</h3>
              <p className="text-muted-foreground">
                Automatically flag when actual data deviates from predictions. Stay informed about unusual patterns instantly.
              </p>
            </motion.div>

            {/* Feature 4 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-4)', opacity: 0.2 }}>
                <FiTarget className="h-6 w-6" style={{ color: 'var(--chart-4)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Scenario Planning</h3>
              <p className="text-muted-foreground">
                Explore what-if scenarios instantly. Adjust forecast points and see cascading impacts on your projections.
              </p>
            </motion.div>

            {/* Feature 5 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-5)', opacity: 0.2 }}>
                <FiFileText className="h-6 w-6" style={{ color: 'var(--chart-5)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Professional Reports</h3>
              <p className="text-muted-foreground">
                Generate beautiful PDF reports in one click. Perfect for stakeholder presentations and board meetings.
              </p>
            </motion.div>

            {/* Feature 6 */}
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-2xl border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--chart-1)', opacity: 0.2 }}>
                <FiBarChart2 className="h-6 w-6" style={{ color: 'var(--chart-1)' }} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Business Insights</h3>
              <p className="text-muted-foreground">
                AI-powered analysis explains why forecasts move. Get actionable recommendations tailored to your data.
              </p>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border/50">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="space-y-12"
        >
          <div className="text-center">
            <motion.h2
              variants={itemVariants}
              className="text-3xl sm:text-4xl font-bold"
            >
              Get Started in 3 Steps
            </motion.h2>
          </div>

          <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { num: '1', icon: FiUploadCloud, title: 'Upload Data', desc: 'Import your time series data from Excel, CSV, or JSON' },
              { num: '2', icon: FiActivity, title: 'Run Forecast', desc: 'Configure your forecast horizon and let Prophet work its magic' },
              { num: '3', icon: FiShare2, title: 'Analyze & Share', desc: 'Explore insights, create scenarios, and export professional reports' },
            ].map((step, i) => (
              <motion.div key={i} variants={itemVariants} className="text-center">
                <div
                  className="relative h-14 w-14 rounded-full grid place-items-center text-white mx-auto mb-4 glow"
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  <step.icon className="h-6 w-6" />
                  <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border grid place-items-center text-[11px] font-bold text-foreground">
                    {step.num}
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <p className="text-muted-foreground">{step.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-border/50">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="relative rounded-2xl overflow-hidden p-8 sm:p-12"
          style={{
            background: 'linear-gradient(135deg, rgba(var(--chart-1-rgb), 0.1) 0%, rgba(var(--chart-3-rgb), 0.1) 100%)',
            border: '1px solid var(--border)',
          }}
        >
          <motion.div variants={itemVariants} className="text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl font-bold">Ready to forecast with confidence?</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Join teams that trust Aurai for accurate predictions and collaborative insights.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link
                to="/login"
                className="px-8 py-3 rounded-lg text-base font-semibold text-white glow inline-flex items-center justify-center gap-2"
                style={{ background: 'var(--gradient-primary)' }}
              >
                Get Started Now <FiArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-6 w-6 rounded-lg grid place-items-center text-white text-sm" style={{ background: 'var(--gradient-primary)' }}>
                  <FiZap className="h-3 w-3" />
                </div>
                <span className="font-semibold">Aurai</span>
              </div>
              <p className="text-sm text-muted-foreground">AI-powered forecasting for modern teams.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-foreground transition-colors">Features</button></li>
                <li><Link to="/login" className="hover:text-foreground transition-colors">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Learn</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">API Reference</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border/50 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <p>&copy; 2025 Aurai. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
