import type { JSX, ReactNode } from 'react';

export interface FraterUnionMarkProps {
  readonly children: ReactNode;
}

export function FraterUnionMark({ children }: FraterUnionMarkProps): JSX.Element {
  return <span style={{ fontWeight: 600 }}>{children}</span>;
}
