import React from "react";
import "./liquid-glass.css";

/* Coach — Liquid Glass (variation 1b). Presentational only; wire your own
   handlers/data. Every Coach surface is: Stage > Panel > Card > sections. */

export function GlassStage({ children, className = "", style }) {
  return (
    <div className={`lg-stage ${className}`} style={style}>
      <div className="lg-blob lg-blob--cyan" />
      <div className="lg-blob lg-blob--rose" />
      <div className="lg-blob lg-blob--sun" />
      {children}
    </div>
  );
}

export function GlassPanel({ children, className = "", style }) {
  return (
    <div className={`lg-panel ${className}`} style={style}>
      <div className="lg-card">{children}</div>
    </div>
  );
}

export function CoachCard({
  title = "Coach",
  subtitle = "heads up",
  tone = "amber",              // amber | green | red -> header dot + badge
  badge = "HEADS UP",
  children,                    // message body (may contain <code className="lg-code">)
  primaryLabel = "Check code",
  secondaryLabel = "Hint",
  dismissLabel = "Got it",
  meta,                        // e.g. "35 AI calls · 22 checks, 8 reviews, 4 hints, 1 asks"
  collapsed = false,
  onPrimary, onSecondary, onDismiss, onToggle,
}) {
  const dotTone = { amber: "", green: " lg-dot--green", red: " lg-dot--red" }[tone] ?? "";
  const badgeTone = { amber: "", green: " lg-badge--success", red: " lg-badge--error" }[tone] ?? "";

  return (
    <GlassPanel>
      <header className="lg-head">
        <span className={`lg-dot${dotTone}`} />
        <span className="lg-title">{title}</span>
        <span className="lg-subtitle">{subtitle}</span>
        <span className="lg-spacer" />
        <button className="lg-icon-btn" onClick={onToggle} aria-expanded={!collapsed} aria-label="Toggle">▾</button>
      </header>

      {!collapsed && (
        <>
          <hr className="lg-divider" />
          <div className="lg-body">
            {badge && <span className={`lg-badge${badgeTone}`}>{badge}</span>}
            {children}
          </div>
          <div className="lg-actions">
            {primaryLabel && <button className="lg-btn lg-btn--primary" onClick={onPrimary}>{primaryLabel}</button>}
            {secondaryLabel && <button className="lg-btn" onClick={onSecondary}>{secondaryLabel}</button>}
            <span className="lg-spacer" />
            {dismissLabel && <button className="lg-btn lg-btn--quiet" onClick={onDismiss}>{dismissLabel}</button>}
          </div>
          {meta && (
            <>
              <hr className="lg-divider lg-divider--quiet" />
              <div className="lg-footer">{meta}</div>
            </>
          )}
        </>
      )}
    </GlassPanel>
  );
}

/* Usage
<GlassStage style={{ minHeight: "100vh", padding: 48 }}>
  <CoachCard
    meta="35 AI calls · 22 checks, 8 reviews, 4 hints, 1 asks"
    onPrimary={runCheck}
  >
    Check the last-index case, indexing{" "}
    <code className="lg-code">flowerbed[len(flowerbed)]</code>{" "}
    will crash and the boundary logic looks off.
  </CoachCard>
</GlassStage>
*/
