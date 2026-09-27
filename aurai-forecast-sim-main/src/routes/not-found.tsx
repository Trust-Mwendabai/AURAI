import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass rounded-3xl p-10 text-center max-w-md">
        <h1 className="text-7xl font-bold gradient-text">404</h1>
        <p className="mt-3 text-muted-foreground">The page you're looking for doesn't exist.</p>
        <Link to="/dashboard" className="mt-6 inline-block rounded-xl px-5 py-2.5 text-sm font-medium text-white glow" style={{ background: "var(--gradient-primary)" }}>
          Go home
        </Link>
      </div>
    </div>
  );
}
