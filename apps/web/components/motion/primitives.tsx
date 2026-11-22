'use client';

import React, { useEffect, useState, useRef, useId } from 'react';

/**
 * MUXARO Opening Timeline Choreography Constants
 *
 * Strict budget: entire opening choreography completes within ~950ms
 * so all inputs are immediately interactive and available.
 */
export const MOTION_TIMELINE = {
  HEADLINE_LINE_1_DELAY: 0,
  HEADLINE_LINE_2_DELAY: 75,
  HEADLINE_DURATION: 650,
  SUBTITLE_DELAY: 180,
  SUBTITLE_DURATION: 550,
  HAIRLINE_DELAY: 220,
  HAIRLINE_DURATION: 600,
  WORKSPACE_CARD_DELAY: 260,
  WORKSPACE_CARD_DURATION: 650,
  SECONDARY_TRUST_DELAY: 340,
  SECONDARY_TRUST_DURATION: 550,
  TOTAL_CHOREOGRAPHY_BUDGET: 950,
  EASING_EDITORIAL: 'cubic-bezier(0.22, 1, 0.36, 1)',
  EASING_TACTILE: 'cubic-bezier(0.2, 0, 0, 1)',
  EASING_SNAPPY: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/**
 * SSR-safe hook detecting prefers-reduced-motion media query.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReduced(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Legacy fallback
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return prefersReduced;
}

/* -------------------------------------------------------------------------- */
/* 1. Masked Text Reveal Primitive                                            */
/* -------------------------------------------------------------------------- */

export interface MaskedTextRevealProps {
  /** Array of lines to reveal sequentially, or single text string */
  lines?: string[];
  /** Optional custom React children (will be wrapped in a single mask) */
  children?: React.ReactNode;
  /** Container CSS classes */
  className?: string;
  /** Inner line item CSS classes */
  lineClassName?: string;
  /** Mask wrapper CSS classes */
  maskClassName?: string;
  /** Stagger between sequential lines in milliseconds (default: 75ms) */
  staggerMs?: number;
  /** Base delay before the first line starts in milliseconds (default: 0ms) */
  baseDelayMs?: number;
  /** Animation duration in milliseconds (default: 650ms) */
  durationMs?: number;
  /** Render element tag (default: 'div') */
  as?: React.ElementType;
}

/**
 * MaskedTextReveal: Glides headline lines or text smoothly upward (translateY(110%) -> 0%)
 * inside an overflow-hidden wrapper using cubic-bezier(0.22, 1, 0.36, 1).
 */
export function MaskedTextReveal({
  lines,
  children,
  className = '',
  lineClassName = '',
  maskClassName = '',
  staggerMs = MOTION_TIMELINE.HEADLINE_LINE_2_DELAY,
  baseDelayMs = MOTION_TIMELINE.HEADLINE_LINE_1_DELAY,
  durationMs = MOTION_TIMELINE.HEADLINE_DURATION,
  as: Component = 'div',
}: MaskedTextRevealProps) {
  const prefersReduced = usePrefersReducedMotion();

  // If reduced motion is preferred, render static content immediately
  if (prefersReduced) {
    return (
      <Component className={className}>
        {lines
          ? lines.map((line, i) => (
              <span key={i} className={`block ${lineClassName}`}>
                {line}
              </span>
            ))
          : children}
      </Component>
    );
  }

  if (lines && lines.length > 0) {
    return (
      <Component className={className}>
        {lines.map((line, index) => {
          const delay = baseDelayMs + index * staggerMs;
          return (
            <span
              key={index}
              className={`motion-mask-block ${maskClassName}`}
              style={{ display: 'block' }}
            >
              <span
                className={`motion-reveal-block ${lineClassName}`}
                style={{
                  animationDelay: `${delay}ms`,
                  animationDuration: `${durationMs}ms`,
                }}
              >
                {line}
              </span>
            </span>
          );
        })}
      </Component>
    );
  }

  return (
    <Component className={`motion-mask ${maskClassName} ${className}`}>
      <span
        className={`motion-reveal-item ${lineClassName}`}
        style={{
          animationDelay: `${baseDelayMs}ms`,
          animationDuration: `${durationMs}ms`,
        }}
      >
        {children}
      </span>
    </Component>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Editorial Fade Up Primitive                                             */
/* -------------------------------------------------------------------------- */

export interface EditorialFadeUpProps {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
  durationMs?: number;
  as?: React.ElementType;
  style?: React.CSSProperties;
}

/**
 * EditorialFadeUp: Subtle vertical entrance (14px -> 0, opacity: 0 -> 1)
 * with cubic-bezier(0.22, 1, 0.36, 1) for subtitle, workspace card, and section headers.
 */
export function EditorialFadeUp({
  children,
  className = '',
  delayMs = MOTION_TIMELINE.SUBTITLE_DELAY,
  durationMs = MOTION_TIMELINE.SUBTITLE_DURATION,
  as: Component = 'div',
  style = {},
}: EditorialFadeUpProps) {
  const prefersReduced = usePrefersReducedMotion();

  if (prefersReduced) {
    return (
      <Component className={className} style={style}>
        {children}
      </Component>
    );
  }

  return (
    <Component
      className={`motion-fade-up ${className}`}
      style={{
        ...style,
        animationDelay: `${delayMs}ms`,
        animationDuration: `${durationMs}ms`,
      }}
    >
      {children}
    </Component>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Hairline Reveal Primitive                                               */
/* -------------------------------------------------------------------------- */

export interface HairlineRevealProps {
  className?: string;
  delayMs?: number;
  durationMs?: number;
  origin?: 'left' | 'center' | 'right';
  as?: React.ElementType;
  style?: React.CSSProperties;
}

/**
 * HairlineReveal: Subtle horizontal rule drawing smoothly from scaleX(0) -> scaleX(1)
 * with GPU compositing and zero layout shift.
 */
export function HairlineReveal({
  className = '',
  delayMs = MOTION_TIMELINE.HAIRLINE_DELAY,
  durationMs = MOTION_TIMELINE.HAIRLINE_DURATION,
  origin = 'left',
  as: Component = 'div',
  style = {},
}: HairlineRevealProps) {
  const prefersReduced = usePrefersReducedMotion();

  const originClass =
    origin === 'center'
      ? 'motion-hairline-center'
      : origin === 'right'
      ? 'motion-hairline-right'
      : '';

  if (prefersReduced) {
    return (
      <Component
        className={`w-full h-px ${className}`}
        style={style}
        aria-hidden="true"
      />
    );
  }

  return (
    <Component
      className={`motion-hairline ${originClass} ${className}`}
      style={{
        ...style,
        animationDelay: `${delayMs}ms`,
        animationDuration: `${durationMs}ms`,
      }}
      aria-hidden="true"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Tactile Segmented Sliding Indicator Primitive                           */
/* -------------------------------------------------------------------------- */

export interface TactileSegmentedIndicatorProps {
  /** Active zero-indexed tab index */
  activeIndex: number;
  /** Total count of tabs in the segmented group */
  totalTabs: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * TactileSegmentedIndicator: Smooth sliding tab highlight pill powered by
 * GPU-composited transform: translateX(...) and cubic-bezier(0.2, 0, 0, 1).
 * Never animates width, height, top, or left (Hallmark compliant).
 */
export function TactileSegmentedIndicator({
  activeIndex,
  totalTabs,
  className = '',
  style = {},
}: TactileSegmentedIndicatorProps) {
  const prefersReduced = usePrefersReducedMotion();

  const tabWidthPercent = totalTabs > 0 ? 100 / totalTabs : 50;
  const clampedIndex = Math.max(0, Math.min(activeIndex, totalTabs - 1));

  return (
    <div
      className={`tactile-segmented-indicator ${className}`}
      style={{
        width: `calc(${tabWidthPercent}% - 4px)`,
        transform: prefersReduced
          ? `translateX(calc(${clampedIndex * 100}% + ${clampedIndex * 4}px))`
          : `translateX(calc(${clampedIndex * 100}% + ${clampedIndex * 4}px))`,
        transition: prefersReduced ? 'none' : undefined,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Tactile Segmented Group Component                                       */
/* -------------------------------------------------------------------------- */

export interface TactileTabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export interface TactileSegmentedGroupProps<T extends string = string> {
  items: TactileTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  tabClassName?: string;
  ariaLabel?: string;
}

/**
 * TactileSegmentedGroup: Accessible luxury segmented tab control with
 * integrated sliding tactile indicator and instant keyboard navigation.
 */
export function TactileSegmentedGroup<T extends string = string>({
  items,
  value,
  onChange,
  className = '',
  tabClassName = '',
  ariaLabel = 'Choose option',
}: TactileSegmentedGroupProps<T>) {
  const groupId = useId();
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value)
  );

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`tactile-segmented-group ${className}`}
    >
      <TactileSegmentedIndicator
        activeIndex={activeIndex}
        totalTabs={items.length}
      />
      {items.map((item, index) => {
        const isActive = item.id === value;
        const Icon = item.icon;
        const tabId = `${groupId}-tab-${item.id}`;
        const panelId = `${groupId}-panel-${item.id}`;

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const next = (index + 1) % items.length;
                onChange(items[next].id);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = (index - 1 + items.length) % items.length;
                onChange(items[prev].id);
              }
            }}
            className={`tactile-segmented-tab ${isActive ? 'active' : ''} ${tabClassName}`}
          >
            {Icon && (
              <Icon
                className="w-3.5 h-3.5 shrink-0"
                aria-hidden={true}
              />
            )}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
