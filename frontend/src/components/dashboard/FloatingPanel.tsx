'use client';

import { useRef, useState, type ReactNode, type CSSProperties } from 'react';

interface FloatingPanelProps {
	children: ReactNode;
	title?: string;
	/** Default position from left edge */
	defaultX: number;
	/** Default position from top edge */
	defaultY: number;
	/** Extra content rendered in the drag handle row (e.g. maximize button) */
	headerExtra?: ReactNode;
	className?: string;
	style?: CSSProperties;
	id?: string;
	/** Width of the panel, e.g. "320px" */
	width?: string;
}

export default function FloatingPanel({
	children,
	title,
	defaultX,
	defaultY,
	headerExtra,
	className = '',
	style,
	id,
	width,
}: FloatingPanelProps) {
	const [pos, setPos] = useState({ x: defaultX, y: defaultY });
	const dragging = useRef(false);
	const offset = useRef({ x: 0, y: 0 });

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		// Only drag on the handle itself, not on child buttons inside it
		if ((e.target as HTMLElement).closest('button')) return;
		dragging.current = true;
		offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		const newX = e.clientX - offset.current.x;
		const newY = e.clientY - offset.current.y;
		setPos({ x: Math.max(0, newX), y: Math.max(0, newY) });
	};

	const onPointerUp = () => {
		dragging.current = false;
	};

	return (
		<div
			id={id}
			className={`fixed z-30 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 ${className}`}
			style={{
				left: pos.x,
				top: pos.y,
				width,
				background: 'rgba(6, 10, 22, 0.72)',
				backdropFilter: 'blur(20px) saturate(180%)',
				WebkitBackdropFilter: 'blur(20px) saturate(180%)',
				...style,
			}}
		>
			{/* ── Drag Handle ────────────────────────────────────── */}
			<div
				className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none"
				style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			>
				<div className="flex items-center gap-2.5">
					{/* Grip dots */}
					<svg width="12" height="12" viewBox="0 0 12 12" className="opacity-30">
						{[0, 4, 8].map((x) =>
							[0, 4, 8].map((y) => (
								<circle key={`${x}-${y}`} cx={x + 2} cy={y + 2} r="1" fill="white" />
							))
						)}
					</svg>
					{title && (
						<span
							className="text-[9px] font-bold tracking-[0.25em] uppercase"
							style={{ color: 'rgba(0,255,136,0.7)' }}
						>
							{title}
						</span>
					)}
				</div>
				{headerExtra && <div className="flex items-center gap-1.5">{headerExtra}</div>}
			</div>

			{/* ── Content ────────────────────────────────────────── */}
			{children}
		</div>
	);
}
