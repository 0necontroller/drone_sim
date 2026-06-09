'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
	ArrowRight,
	Scan,
	MapPin,
	Brain,
	Shield,
	Video,
	BarChart3,
	AlertTriangle,
	Waves,
	Plane,
	Eye,
	Radar,
	Zap,
	Target,
} from 'lucide-react';
import MyCookieConsent from '../../hooks/use-cookie-consent';

/* ─── Reusable glassmorphism card wrapper ────────────────────────────────── */
function GlassCard({
	children,
	className = '',
	accent = false,
}: {
	children: React.ReactNode;
	className?: string;
	accent?: boolean;
}) {
	return (
		<div
			className={`rounded-2xl border overflow-hidden ${className}`}
			style={{
				background: accent
					? 'rgba(0,255,136,0.04)'
					: 'rgba(6,10,22,0.6)',
				backdropFilter: 'blur(20px) saturate(180%)',
				WebkitBackdropFilter: 'blur(20px) saturate(180%)',
				borderColor: accent
					? 'rgba(0,255,136,0.15)'
					: 'rgba(255,255,255,0.08)',
			}}
		>
			{children}
		</div>
	);
}

/* ─── Micro label ────────────────────────────────────────────────────────── */
function MicroLabel({
	children,
	className = '',
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<span
			className={`text-[8px] font-bold tracking-[0.25em] uppercase ${className}`}
			style={{ color: 'rgba(0,255,136,0.6)' }}
		>
			{children}
		</span>
	);
}

/* ─── Animated grid background ───────────────────────────────────────────── */
function GridBackground() {
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{/* Radial glow */}
			<div
				className="absolute inset-0"
				style={{
					background:
						'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,255,136,0.07) 0%, transparent 60%)',
				}}
			/>
			{/* Grid lines */}
			<div
				className="absolute inset-0 opacity-[0.04]"
				style={{
					backgroundImage: `
						linear-gradient(rgba(0,255,136,0.3) 1px, transparent 1px),
						linear-gradient(90deg, rgba(0,255,136,0.3) 1px, transparent 1px)
					`,
					backgroundSize: '60px 60px',
				}}
			/>
			{/* Vignette */}
			<div
				className="absolute inset-0"
				style={{
					background:
						'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.6) 100%)',
				}}
			/>
			{/* Scanlines */}
			<div
				className="absolute inset-0 opacity-[0.025]"
				style={{
					backgroundImage:
						'repeating-linear-gradient(0deg, rgba(0,0,0,0.8) 0px, rgba(0,0,0,0.8) 1px, transparent 1px, transparent 2px)',
					backgroundSize: '100% 2px',
				}}
			/>
		</div>
	);
}

/* ─── Floating particles ─────────────────────────────────────────────────── */
function Particles() {
	const particles = Array.from({ length: 30 }, (_, i) => ({
		id: i,
		x: Math.random() * 100,
		y: Math.random() * 100,
		size: Math.random() * 2 + 1,
		duration: Math.random() * 20 + 15,
		delay: Math.random() * 10,
		opacity: Math.random() * 0.3 + 0.05,
	}));

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{particles.map((p) => (
				<div
					key={p.id}
					className="absolute rounded-full"
					style={{
						left: `${p.x}%`,
						top: `${p.y}%`,
						width: p.size,
						height: p.size,
						background: '#00ff88',
						opacity: p.opacity,
						animation: `float-particle ${p.duration}s ease-in-out infinite`,
						animationDelay: `${p.delay}s`,
					}}
				/>
			))}
		</div>
	);
}

/* ─── Hero section ───────────────────────────────────────────────────────── */
function Hero() {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const t = setTimeout(() => setVisible(true), 100);
		return () => clearTimeout(t);
	}, []);

	return (
		<section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
			<GridBackground />
			<Particles />

			<div
				className="relative z-10 flex flex-col items-center gap-8 max-w-4xl transition-all duration-1000"
				style={{
					opacity: visible ? 1 : 0,
					transform: visible ? 'translateY(0)' : 'translateY(30px)',
				}}
			>
				{/* Status badge */}
				<div
					className="flex items-center gap-2 rounded-full px-4 py-1.5"
					style={{
						background: 'rgba(0,255,136,0.08)',
						border: '1px solid rgba(0,255,136,0.2)',
					}}
				>
					<span className="relative flex h-2 w-2">
						<span
							className="absolute inline-flex h-full w-full rounded-full"
							style={{
								background: '#00ff88',
								animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
							}}
						/>
						<span
							className="relative inline-flex h-2 w-2 rounded-full"
							style={{ background: '#00ff88' }}
						/>
					</span>
					<span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: '#00ff88' }}>
						Autonomous System Active
					</span>
				</div>

				{/* Title */}
				<h1
					className="text-5xl font-bold leading-[1.1] tracking-tight md:text-7xl lg:text-8xl"
					style={{ color: '#fff' }}
				>
					Autonomous Drones
					<br />
					<span style={{ color: '#00ff88' }}>Flood Rescue</span>
					<br />
					Operations
				</h1>

				{/* Subtitle */}
				<p
					className="max-w-2xl text-base leading-relaxed md:text-lg"
					style={{ color: 'rgba(255,255,255,0.5)' }}
				>
					Real-time autonomous drone navigation and survivor detection
					for rapid flood disaster response. Powered by SLAM, LIDAR, and
					computer vision.
				</p>

				{/* CTAs */}
				<div className="flex flex-wrap items-center justify-center gap-4">
					<Link
						href="/dashboard"
						className="group flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-wider uppercase transition-all hover:scale-[1.02] active:scale-95"
						style={{
							background: '#00ff88',
							color: '#000',
							boxShadow: '0 0 30px rgba(0,255,136,0.3), 0 0 60px rgba(0,255,136,0.1)',
						}}
					>
						Launch Dashboard
						<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
					</Link>
					<a
						href="#capabilities"
						className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-wider uppercase transition-all hover:scale-[1.02] active:scale-95"
						style={{
							background: 'rgba(255,255,255,0.06)',
							border: '1px solid rgba(255,255,255,0.12)',
							color: 'rgba(255,255,255,0.7)',
						}}
					>
						Learn More
					</a>
				</div>

				{/* Scroll indicator */}
				<div className="mt-8 flex flex-col items-center gap-2 opacity-40">
					<span className="text-[9px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>
						Scroll
					</span>
					<div className="h-8 w-px animate-pulse" style={{ background: 'rgba(0,255,136,0.4)' }} />
				</div>
			</div>
		</section>
	);
}

/* ─── Stats ribbon ───────────────────────────────────────────────────────── */
function StatsRibbon() {
	const stats = [
		{ value: '< 2s', label: 'Detection Latency' },
		{ value: '97.3%', label: 'Survivor Detection' },
		{ value: '360°', label: 'LIDAR Coverage' },
		{ value: ' Autonomous', label: 'Navigation Mode' },
	];

	return (
		<section className="relative px-6 py-12">
			<div className="mx-auto max-w-5xl">
				<GlassCard>
					<div className="grid grid-cols-2 md:grid-cols-4">
						{stats.map((s, i) => (
							<div
								key={s.label}
								className="flex flex-col items-center gap-1 px-6 py-6"
								style={{
									borderRight:
										i < stats.length - 1
											? '1px solid rgba(255,255,255,0.06)'
											: 'none',
								}}
							>
								<span className="font-mono text-2xl font-bold md:text-3xl" style={{ color: '#00ff88' }}>
									{s.value}
								</span>
								<span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
									{s.label}
								</span>
							</div>
						))}
					</div>
				</GlassCard>
			</div>
		</section>
	);
}

/* ─── Problem section ────────────────────────────────────────────────────── */
function ProblemSection() {
	return (
		<section className="relative px-6 py-24">
			<div className="mx-auto max-w-5xl">
				<div className="flex flex-col gap-16 md:flex-row md:items-start md:gap-20">
					{/* Left — label + heading */}
					<div className="flex flex-col gap-4 md:w-1/3">
						<MicroLabel>The Problem</MicroLabel>
						<h2
							className="text-3xl font-bold leading-tight md:text-4xl"
							style={{ color: '#fff' }}
						>
							Floods strike fast.
							<br />
							<span style={{ color: '#ef4444' }}>Response is slow.</span>
						</h2>
						<p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
							Every year, floods displace millions. Traditional rescue
							operations are hampered by limited visibility, treacherous
							terrain, and the sheer scale of disaster zones.
						</p>
					</div>

					{/* Right — problem cards */}
					<div className="flex flex-1 flex-col gap-4">
						{[
							{
								icon: AlertTriangle,
								title: 'Limited Access',
								desc: 'Flooded areas are often unreachable by ground vehicles, leaving survivors stranded for hours or days.',
								color: '#ef4444',
							},
							{
								icon: Eye,
								title: 'Poor Visibility',
								desc: 'Debris, murky water, and weather conditions make visual detection of survivors extremely difficult.',
								color: '#f59e0b',
							},
							{
								icon: Target,
								title: 'Time Critical',
								desc: 'The golden rescue window is narrow. Every minute counts when survivors are exposed to cold water and debris.',
								color: '#60a5fa',
							},
						].map((item) => (
							<GlassCard key={item.title} className="p-5">
								<div className="flex items-start gap-4">
									<div
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
										style={{
											background: `${item.color}10`,
											border: `1px solid ${item.color}30`,
										}}
									>
										<item.icon className="h-5 w-5" style={{ color: item.color }} />
									</div>
									<div className="flex flex-col gap-1.5">
										<h3 className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
											{item.title}
										</h3>
										<p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
											{item.desc}
										</p>
									</div>
								</div>
							</GlassCard>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

/* ─── Capabilities grid ──────────────────────────────────────────────────── */
function Capabilities() {
	const features = [
		{
			icon: Brain,
			title: 'Autonomous Navigation',
			desc: 'SLAM-based path planning enables drones to navigate complex flood environments without human input.',
			tag: 'AI',
		},
		{
			icon: Scan,
			title: '3D LIDAR Mapping',
			desc: 'Real-time point cloud generation creates detailed 3D maps of disaster zones for situational awareness.',
			tag: 'LIDAR',
		},
		{
			icon: Eye,
			title: 'Survivor Detection',
			desc: 'Computer vision algorithms identify and locate survivors in debris fields and floodwaters.',
			tag: 'CV',
		},
		{
			icon: Video,
			title: 'Live Camera Feed',
			desc: 'HD video streaming back to the command center for real-time visual assessment of conditions.',
			tag: 'FEED',
		},
		{
			icon: MapPin,
			title: 'GPS-Denied Navigation',
			desc: 'Visual-inertial odometry and LIDAR SLAM enable operation when GPS signals are unavailable.',
			tag: 'NAV',
		},
		{
			icon: Shield,
			title: 'Obstacle Avoidance',
			desc: 'Multi-sensor fusion ensures safe flight through cluttered environments with dynamic obstacles.',
			tag: 'SAFE',
		},
	];

	return (
		<section id="capabilities" className="relative px-6 py-24">
			<div className="mx-auto max-w-5xl">
				<div className="flex flex-col items-center gap-4 text-center mb-16">
					<MicroLabel>System Capabilities</MicroLabel>
					<h2 className="text-3xl font-bold md:text-4xl" style={{ color: '#fff' }}>
						Built for the <span style={{ color: '#00ff88' }}>worst conditions</span>
					</h2>
					<p className="max-w-xl text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
						Every component is designed to operate autonomously in
						environments where human rescuers cannot safely go.
					</p>
				</div>

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{features.map((f) => (
						<GlassCard key={f.title} className="group p-6 transition-all hover:border-white/15">
							<div className="flex flex-col gap-4">
								<div className="flex items-center justify-between">
									<div
										className="flex h-10 w-10 items-center justify-center rounded-xl transition-all group-hover:scale-110"
										style={{
											background: 'rgba(0,255,136,0.08)',
											border: '1px solid rgba(0,255,136,0.2)',
										}}
									>
										<f.icon className="h-5 w-5" style={{ color: '#00ff88' }} />
									</div>
									<span
										className="rounded-md px-2 py-0.5 text-[8px] font-bold tracking-[0.15em] uppercase"
										style={{
											background: 'rgba(0,255,136,0.08)',
											color: 'rgba(0,255,136,0.6)',
											border: '1px solid rgba(0,255,136,0.12)',
										}}
									>
										{f.tag}
									</span>
								</div>
								<div className="flex flex-col gap-2">
									<h3 className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
										{f.title}
									</h3>
									<p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
										{f.desc}
									</p>
								</div>
							</div>
						</GlassCard>
					))}
				</div>
			</div>
		</section>
	);
}

/* ─── How it works (pipeline) ────────────────────────────────────────────── */
function HowItWorks() {
	const steps = [
		{ num: '01', title: 'Deploy', desc: 'Launch drone into disaster zone. System initialises SLAM and begins mapping.', icon: Plane },
		{ num: '02', title: 'Scan', desc: 'LIDAR and cameras capture 3D point clouds and visual data in real time.', icon: Radar },
		{ num: '03', title: 'Detect', desc: 'AI algorithms identify survivors, obstacles, and safe landing zones.', icon: Eye },
		{ num: '04', title: 'Report', desc: 'Telemetry, detections, and maps stream live to the command dashboard.', icon: BarChart3 },
	];

	return (
		<section className="relative px-6 py-24">
			<div className="mx-auto max-w-5xl">
				<div className="flex flex-col items-center gap-4 text-center mb-16">
					<MicroLabel>Mission Pipeline</MicroLabel>
					<h2 className="text-3xl font-bold md:text-4xl" style={{ color: '#fff' }}>
						How it <span style={{ color: '#00ff88' }}>works</span>
					</h2>
				</div>

				<div className="grid gap-4 md:grid-cols-4">
					{steps.map((s, i) => (
						<div key={s.num} className="relative flex flex-col items-center text-center">
							<GlassCard className="w-full p-6 flex flex-col items-center gap-4">
								{/* Step number */}
								<span
									className="font-mono text-[10px] font-bold tracking-[0.3em]"
									style={{ color: 'rgba(0,255,136,0.4)' }}
								>
									STEP {s.num}
								</span>
								{/* Icon */}
								<div
									className="flex h-14 w-14 items-center justify-center rounded-2xl"
									style={{
										background: 'rgba(0,255,136,0.06)',
										border: '1px solid rgba(0,255,136,0.15)',
									}}
								>
									<s.icon className="h-6 w-6" style={{ color: '#00ff88' }} />
								</div>
								<h3 className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>
									{s.title}
								</h3>
								<p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
									{s.desc}
								</p>
							</GlassCard>
							{/* Connector arrow */}
							{i < steps.length - 1 && (
								<div className="absolute -right-2 top-1/2 hidden -translate-y-1/2 md:block">
									<svg width="16" height="16" viewBox="0 0 16 16" className="opacity-20">
										<path d="M4 8h8M8 4l4 4-4 4" stroke="#00ff88" strokeWidth="1.5" fill="none" />
									</svg>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ─── Tech stack ─────────────────────────────────────────────────────────── */
function TechStack() {
	const techs = [
		{ name: 'Python', role: 'Backend / Simulation' },
		{ name: 'Next.js', role: 'Dashboard UI' },
		{ name: 'Three.js', role: '3D Point Cloud' },
		{ name: 'WebSocket', role: 'Real-time Telemetry' },
		{ name: 'LIDAR', role: 'Spatial Mapping' },
		{ name: 'SLAM', role: 'Autonomous Navigation' },
		{ name: 'OpenCV', role: 'Computer Vision' },
		{ name: 'PyBullet', role: 'Physics Simulation' },
	];

	return (
		<section className="relative px-6 py-24">
			<div className="mx-auto max-w-5xl">
				<div className="flex flex-col items-center gap-4 text-center mb-16">
					<MicroLabel>Technology</MicroLabel>
					<h2 className="text-3xl font-bold md:text-4xl" style={{ color: '#fff' }}>
						Tech <span style={{ color: '#00ff88' }}>stack</span>
					</h2>
				</div>

				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{techs.map((t) => (
						<GlassCard key={t.name} className="group p-4 text-center transition-all hover:border-white/15">
							<div className="flex flex-col items-center gap-2">
								<span className="font-mono text-sm font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>
									{t.name}
								</span>
								<span className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'rgba(0,255,136,0.5)' }}>
									{t.role}
								</span>
							</div>
						</GlassCard>
					))}
				</div>
			</div>
		</section>
	);
}

/* ─── CTA banner ─────────────────────────────────────────────────────────── */
function CtaBanner() {
	return (
		<section className="relative px-6 py-24">
			<div className="mx-auto max-w-3xl">
				<GlassCard accent className="p-10 md:p-16 text-center">
					<div className="flex flex-col items-center gap-6">
						<div
							className="flex h-16 w-16 items-center justify-center rounded-2xl"
							style={{
								background: 'rgba(0,255,136,0.1)',
								border: '1px solid rgba(0,255,136,0.25)',
							}}
						>
							<Zap className="h-7 w-7" style={{ color: '#00ff88' }} />
						</div>
						<h2 className="text-2xl font-bold md:text-3xl" style={{ color: '#fff' }}>
							Ready to see it in action?
						</h2>
						<p className="max-w-md text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
							Launch the real-time dashboard to control the drone, plan
							missions, and monitor autonomous search operations.
						</p>
						<Link
							href="/dashboard"
							className="group flex items-center gap-2 rounded-xl px-8 py-3.5 text-sm font-bold tracking-wider uppercase transition-all hover:scale-[1.02] active:scale-95"
							style={{
								background: '#00ff88',
								color: '#000',
								boxShadow: '0 0 40px rgba(0,255,136,0.25)',
							}}
						>
							Open Dashboard
							<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
						</Link>
					</div>
				</GlassCard>
			</div>
		</section>
	);
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer() {
	return (
		<footer className="relative px-6 py-12">
			<div className="mx-auto max-w-5xl">
				<div
					className="flex flex-col items-center gap-6 md:flex-row md:justify-between"
					style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}
				>
					<div className="flex flex-col items-center gap-1 md:items-start">
						<span className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: 'rgba(0,255,136,0.6)' }}>
							Drone Rescue Ops
						</span>
						<span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
							School Project — Autonomous Drones in Flood Rescue
						</span>
					</div>
					<div className="flex items-center gap-6">
						<Link
							href="/dashboard"
							className="text-[10px] font-bold tracking-[0.15em] uppercase transition-colors hover:text-white"
							style={{ color: 'rgba(255,255,255,0.35)' }}
						>
							Dashboard
						</Link>
						<span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
							|</span>
						<span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
							Built with Next.js + Three.js + SLAM
						</span>
					</div>
				</div>
			</div>
		</footer>
	);
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function Home() {
	return (
		<div
			className="min-h-screen overflow-x-hidden"
			style={{ background: '#000' }}
		>
			<MyCookieConsent />
			<Hero />
			<StatsRibbon />
			<ProblemSection />
			<Capabilities />
			<HowItWorks />
			<TechStack />
			<CtaBanner />
			<Footer />
		</div>
	);
}
