import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./routes/AppLayout";
import { SkeletonPage } from "@/components/Skeleton";

// Each page loads as its own chunk instead of one ~1.6MB bundle upfront —
// the browser only downloads and parses the page the user actually opens,
// which is most of what determines how fast the app first paints.
const LoginPage = lazy(() => import("./routes/login"));
const RegisterPage = lazy(() => import("./routes/register"));
const ForgotPasswordPage = lazy(() => import("./routes/forgot-password"));
const ResetPasswordPage = lazy(() => import("./routes/reset-password"));
const LandingPage = lazy(() => import("./routes/landing"));
const DashboardPage = lazy(() => import("./routes/dashboard"));
const DatasetPage = lazy(() => import("./routes/dataset"));
const PredictionsPage = lazy(() => import("./routes/predictions"));
const AnalyticsPage = lazy(() => import("./routes/analytics"));
const InsightsPage = lazy(() => import("./routes/insights"));
const WhatIfPage = lazy(() => import("./routes/whatif"));
const ModelArenaPage = lazy(() => import("./routes/model-arena"));
const AuraiPage = lazy(() => import("./routes/aurai"));
const ReportsPage = lazy(() => import("./routes/reports"));
const SettingsPage = lazy(() => import("./routes/settings"));
const ProfilePage = lazy(() => import("./routes/profile"));
const GuidePage = lazy(() => import("./routes/guide"));
const NotFoundPage = lazy(() => import("./routes/not-found"));

export default function App() {
  return (
    <Suspense fallback={<SkeletonPage />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dataset" element={<DatasetPage />} />
          <Route path="/predictions" element={<PredictionsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/whatif" element={<WhatIfPage />} />
          <Route path="/model-arena" element={<ModelArenaPage />} />
          <Route path="/aurai" element={<AuraiPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
