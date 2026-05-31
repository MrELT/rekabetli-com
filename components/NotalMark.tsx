export default function NotalMark({ className = "" }: { className?: string }) {
  return (
    <span className={`notal-mark ${className}`.trim()}>
      <span className="notal-word-not">Not</span>
      <span className="notal-word-al">Al</span>
    </span>
  );
}
