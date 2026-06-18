"use client";

import { useEffect, useRef } from "react";

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    // Light ray configuration
    const rays: Array<{
      angle: number;
      length: number;
      speed: number;
      opacity: number;
      width: number;
    }> = [];

    // Create rays
    for (let i = 0; i < 80; i++) {
      rays.push({
        angle: (Math.PI * 2 * i) / 80,
        length: Math.random() * 500 + 300,
        speed: Math.random() * 0.002 + 0.001,
        opacity: Math.random() * 0.3 + 0.1,
        width: Math.random() * 2 + 0.5,
      });
    }

    let animationFrame: number;
    let time = 0;

    const animate = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Clear canvas with dark background
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, width, height);

      // Center point (slightly offset to right for perspective)
      const centerX = width * 0.6;
      const centerY = height * 0.5;

      // Draw rays
      rays.forEach((ray) => {
        const currentAngle = ray.angle + time * ray.speed;
        const endX = centerX + Math.cos(currentAngle) * ray.length;
        const endY = centerY + Math.sin(currentAngle) * ray.length;

        // Create gradient for each ray
        const gradient = ctx.createLinearGradient(centerX, centerY, endX, endY);
        gradient.addColorStop(0, `rgba(59, 130, 246, ${ray.opacity})`); // Blue
        gradient.addColorStop(0.5, `rgba(96, 165, 250, ${ray.opacity * 0.6})`); // Light blue
        gradient.addColorStop(1, "rgba(59, 130, 246, 0)"); // Transparent

        ctx.strokeStyle = gradient;
        ctx.lineWidth = ray.width;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      });

      // Draw center glow
      const centerGlow = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        150,
      );
      centerGlow.addColorStop(0, "rgba(59, 130, 246, 0.3)");
      centerGlow.addColorStop(0.5, "rgba(59, 130, 246, 0.1)");
      centerGlow.addColorStop(1, "rgba(59, 130, 246, 0)");

      ctx.fillStyle = centerGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 150, 0, Math.PI * 2);
      ctx.fill();

      time += 0.5;
      animationFrame = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", updateSize);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ mixBlendMode: "screen", zIndex: 0 }}
    />
  );
}
