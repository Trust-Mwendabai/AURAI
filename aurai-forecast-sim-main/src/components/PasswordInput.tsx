// @ts-nocheck
import { useId, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

/**
 * Password field with a reveal toggle.
 *
 * `bare` renders just the input + button, for the login form where the field
 * already sits inside its own bordered row with a leading icon.
 */
export function PasswordInput({ bare = false, className = "", icon = null, ...props }: any) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const button = (
    <button
      type="button"
      onClick={() => setVisible((v) => !v)}
      className="text-muted-foreground hover:text-foreground transition-colors p-0.5 shrink-0"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      aria-controls={id}
      tabIndex={-1}
    >
      {visible ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
    </button>
  );

  if (bare) {
    return (
      <>
        <input {...props} id={id} type={visible ? "text" : "password"} className={className} />
        {button}
      </>
    );
  }

  return (
    <div className={`glass rounded-xl flex items-center gap-2 px-3 py-2.5 ${className}`}>
      {icon}
      <input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        className="bg-transparent outline-none text-sm flex-1 min-w-0"
      />
      {button}
    </div>
  );
}
