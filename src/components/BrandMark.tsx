import Image from "next/image";

export default function BrandMark({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={`brand-mark${compact ? " brand-mark--compact" : ""} ${className}`.trim()}>
      <Image
        className="brand-mark__image"
        src="/logo.png"
        width={compact ? 36 : 44}
        height={compact ? 36 : 44}
        alt=""
        priority
        unoptimized
      />
      {!compact && (
        <span className="brand-mark__copy">
          <strong>ItsMyToy</strong>
          <small>Operations</small>
        </span>
      )}
    </span>
  );
}
