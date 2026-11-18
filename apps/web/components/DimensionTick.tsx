import React from 'react';

interface DimensionTickProps {
  label: string;
  value: string;
  unit?: string;
  className?: string;
}

export default function DimensionTick({ label, value, unit, className = '' }: DimensionTickProps) {
  return (
    <div className={`my-3 ${className}`}>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-ink font-semibold">
          {value} {unit && <span className="text-muted font-normal">{unit}</span>}
        </span>
      </div>
      <div className="dim w-full" />
    </div>
  );
}
