'use client';

import { useEffect, useRef } from 'react';
import {
	AlertTriangle,
	CheckCircle2,
	XCircle,
	Radio,
	Navigation,
	Info
} from 'lucide-react';
import FloatingPanel from './FloatingPanel';
import { type LogEntry } from '@/hooks/useMapData';

interface MissionLogProps {
	entries: LogEntry[];
	defaultX?: number;
	defaultY?: number;
}

const TYPE_CONFIG: Record<
	LogEntry['type'],
	{
		icon: React.ReactNode;
		color: string;
		bg: string;
		border: string;
		label: string;
	}
> = {
	detection: {
		icon: <AlertTriangle />,
		color: '#ef4444',
		bg: 'rgba(239,68,68,0.10)',
		border: 'rgba(239,68,68,0.22)',
		label: 'DETECTION'
	},
	mission_start: {
		icon: <Navigation />,
		color: '#00ff88',
		bg: 'rgba(0,255,136,0.08)',
		border: 'rgba(0,255,136,0.2)',
		label: 'MISSION'
	},
	mission_complete: {
		icon: <CheckCircle2 />,
		color: '#00ff88',
		bg: 'rgba(0,255,136,0.06)',
		border: 'rgba(0,255,136,0.15)',
		label: 'COMPLETE'
	},
	abort: {
		icon: <XCircle />,
		color: '#f59e0b',
		bg: 'rgba(245,158,11,0.08)',
		border: 'rgba(245,158,11,0.22)',
		label: 'ABORT'
	},
	waypoints: {
		icon: <Radio />,
		color: '#60a5fa',
		bg: 'rgba(96,165,250,0.08)',
		border: 'rgba(96,165,250,0.18)',
		label: 'PLAN'
	},
	info: {
		icon: <Info />,
		color: 'rgba(255,255,255,0.5)',
		bg: 'rgba(255,255,255,0.04)',
		border: 'rgba(255,255,255,0.08)',
		label: 'INFO'
	}
};

function relativeTime(ts: number): string {
	const secs = Math.floor((Date.now() - ts) / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	return `${Math.floor(mins / 60)}h ago`;
}

function LogRow({ entry }: { entry: LogEntry }) {
	const cfg = TYPE_CONFIG[entry.type];
	const Icon = cfg.icon;

	return (
		<div
			className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
			style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
		>
			<div
				className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
				style={{
					background: `${cfg.color}20`,
					border: `1px solid ${cfg.color}40`
				}}
			>
				{Icon}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center justify-between gap-2">
					<span
						className="text-[8px] font-bold tracking-[0.2em]"
						style={{ color: cfg.color }}
					>
						{cfg.label}
					</span>
					<span
						className="shrink-0 font-mono text-[8px]"
						style={{ color: 'rgba(255,255,255,0.25)' }}
					>
						{relativeTime(entry.timestamp)}
					</span>
				</div>
				<p
					className="text-[10px] leading-snug"
					style={{ color: 'rgba(255,255,255,0.75)' }}
				>
					{entry.message}
				</p>
				{entry.data?.x != null && entry.data?.y != null && (
					<p
						className="font-mono text-[9px]"
						style={{ color: 'rgba(255,255,255,0.35)' }}
					>
						{entry.data.x.toFixed(1)}m, {entry.data.y.toFixed(1)}m
					</p>
				)}
			</div>
		</div>
	);
}

export default function MissionLog({
	entries,
	defaultX = 20,
	defaultY
}: MissionLogProps) {
	const dy = typeof window !== 'undefined' ? window.innerHeight - 380 : 400;
	const scrollRef = useRef<HTMLDivElement>(null);
	const detectionCount = entries.filter((e) => e.type === 'detection').length;

	// Scroll to top whenever a new entry arrives (newest is first)
	useEffect(() => {
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	}, [entries.length]);

	const headerExtra =
		detectionCount > 0 ? (
			<span
				className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold"
				style={{
					background: 'rgba(239,68,68,0.15)',
					border: '1px solid rgba(239,68,68,0.3)',
					color: '#ef4444'
				}}
			>
				<AlertTriangle className="h-2.5 w-2.5" />
				{detectionCount}
			</span>
		) : undefined;

	return (
		<FloatingPanel
			title="Mission Log"
			defaultX={defaultX}
			defaultY={defaultY ?? dy}
			headerExtra={headerExtra}
			width="280px"
		>
			<div
				ref={scrollRef}
				className="flex flex-col gap-1.5 overflow-y-auto p-2.5"
				style={{ maxHeight: 300, minHeight: 80 }}
			>
				{entries.length === 0 ? (
					<div
						className="flex flex-col items-center justify-center gap-2 py-6 text-center"
						style={{ color: 'rgba(255,255,255,0.2)' }}
					>
						<Radio className="h-5 w-5" />
						<p className="font-mono text-[10px]">Awaiting events…</p>
					</div>
				) : (
					entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
				)}
			</div>
		</FloatingPanel>
	);
}
