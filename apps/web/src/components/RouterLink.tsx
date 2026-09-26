/** react-router adapter for Astryx `as` link props (href/className/style/children). */
import { Link } from "react-router";
import type { ReactNode } from "react";

interface RouterLinkProps {
  href: string;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  children: ReactNode;
}

export default function RouterLink({ href, className, style, children }: RouterLinkProps) {
  return (
    <Link to={href} className={className} style={style}>
      {children}
    </Link>
  );
}
