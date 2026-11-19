'use client';

import React from 'react';

export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="muxaro-page-enter-slide w-full">{children}</div>;
}
