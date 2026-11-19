'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useDeviceMode } from '@/lib/device-mode';

interface Particle {
  // Spherical/elliptical orbital coordinates
  theta: number; // Angle around orbit (0 .. 2*PI)
  phi: number; // Elevation angle (-PI/2 .. PI/2)
  radius: number; // Orbital distance from center
  speed: number; // Orbital angular velocity
  size: number; // Particle base pixel radius
  color: string; // Token-based hex color
  opacity: number; // Base opacity
  pulsePhase: number;
}

// MUXARO & Google Antigravity vibrant particle core spectrum
const SPECTRUM = [
  '#36d6d1', // Cyan
  '#4677ff', // Vibrant Blue
  '#695bff', // Electric Indigo
  '#8b5cf6', // Violet
  '#f59e0b', // Amber
  '#ff6b6b', // Coral
  '#ec4899', // Magenta
];

export default function AntigravityOrbitalField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { shouldAnimateAurora } = useDeviceMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Detect user reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches || !shouldAnimateAurora) {
      return;
    }

    let animationFrameId: number;
    let width = (canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1));
    let height = (canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1));

    // Handle viewport resize cleanly
    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
      height = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    };
    window.addEventListener('resize', handleResize);

    // Mouse tracking for subtle orbital tilt / parallax
    let mouseX = 0;
    let mouseY = 0;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let currentTiltX = 0;
    let currentTiltY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      targetTiltX = (x / (rect.width / 2)) * 0.35;
      targetTiltY = (y / (rect.height / 2)) * 0.25;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Initialize 3D orbital particle swarm
    const particleCount = window.innerWidth < 640 ? 60 : 120;
    const particles: Particle[] = [];
    const baseRadiusMin = Math.min(width, height) * 0.22;
    const baseRadiusMax = Math.min(width, height) * 0.48;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        theta: Math.random() * Math.PI * 2,
        phi: (Math.random() - 0.5) * Math.PI * 0.7,
        radius: baseRadiusMin + Math.random() * (baseRadiusMax - baseRadiusMin),
        speed: (0.0018 + Math.random() * 0.0032) * (Math.random() > 0.5 ? 1 : -1),
        size: (1.2 + Math.random() * 2.2) * (window.devicePixelRatio || 1),
        color: SPECTRUM[i % SPECTRUM.length],
        opacity: 0.35 + Math.random() * 0.55,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }

    let globalRotation = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth tilt lerp
      currentTiltX += (targetTiltX - currentTiltX) * 0.05;
      currentTiltY += (targetTiltY - currentTiltY) * 0.05;

      globalRotation += 0.0012;

      const centerX = width / 2;
      const centerY = height * 0.44;

      // Sort particles by depth for correct painter's algorithm rendering
      const projectedList = particles.map((p) => {
        p.theta += p.speed;
        p.pulsePhase += 0.02;

        const totalTheta = p.theta + globalRotation;
        const cosPhi = Math.cos(p.phi + currentTiltY);
        const sinPhi = Math.sin(p.phi + currentTiltY);
        const cosTheta = Math.cos(totalTheta + currentTiltX);
        const sinTheta = Math.sin(totalTheta + currentTiltX);

        // 3D Cartesian coordinates
        const x3d = p.radius * cosPhi * sinTheta;
        const y3d = p.radius * sinPhi;
        const z3d = p.radius * cosPhi * cosTheta;

        // Perspective projection
        const focalLength = Math.min(width, height) * 1.2;
        const scale = focalLength / (focalLength + z3d);

        const screenX = centerX + x3d * scale;
        const screenY = centerY + y3d * scale;
        const depthAlpha = Math.max(0.12, Math.min(1, (z3d + p.radius) / (2 * p.radius)));
        const pulse = 0.85 + Math.sin(p.pulsePhase) * 0.15;

        return {
          screenX,
          screenY,
          size: p.size * scale * pulse,
          color: p.color,
          alpha: p.opacity * depthAlpha * pulse,
          z3d,
        };
      });

      projectedList.sort((a, b) => a.z3d - b.z3d);

      // Draw particle points with luminous soft glow
      for (const p of projectedList) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.screenX, p.screenY, Math.max(0.8, p.size), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.size * 2.5;
        ctx.fill();
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [mounted, shouldAnimateAurora]);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none z-0"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full opacity-70 transition-opacity duration-700 dark:opacity-85"
      />
    </div>
  );
}
