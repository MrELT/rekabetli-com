import Link from "next/link";

interface RekabetliLogoProps {
  href?: string | null;
  className?: string;
}

export default function RekabetliLogo({
  href = "/",
  className = "",
}: RekabetliLogoProps) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/assets/rekabetli.png"
      alt="Rekabetli"
      className={`brand-logo h-8 w-auto ${className}`}
    />
  );

  if (href) {
    return (
      <a href={href} className="brand inline-flex">
        {img}
      </a>
    );
  }

  return img;
}
