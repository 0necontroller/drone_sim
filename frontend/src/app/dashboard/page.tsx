'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { serverUrl } from '@/lib/config';
import { Cormorant_Garamond, IBM_Plex_Sans } from 'next/font/google';

const PointCloudViewer = dynamic(() => import('@/components/PointCloudViewer'), {
	ssr: false,
	loading: () => (
		<div className="flex h-full items-center justify-center text-sm text-white/60">
			Loading 3D viewer…
		</div>
	),
});

const headingFont = Cormorant_Garamond({
	subsets: ['latin'],
	weight: ['400', '600', '700']
});

const bodyFont = IBM_Plex_Sans({
	subsets: ['latin'],
	weight: ['300', '400', '500', '600']
});

type Telemetry = {
	time?: number;
	roll?: number;
	pitch?: number;
	yaw?: number;
	x?: number;
	y?: number;
	z?: number;
	altitude?: number;
	roll_velocity?: number;
	pitch_velocity?: number;
	target_altitude?: number;
};

type ControlCommand = {
	roll: number;
	pitch: number;
	yaw: number;
	altitude_delta: number;
};

const WS_PATH = '/api/v1/drone/ws';
const RTC_PATH = '/api/v1/drone/rtc';
const RTC_ICE_SERVERS = process.env.NEXT_PUBLIC_RTC_ICE_SERVERS;

const toWsUrl = (base?: string, path = WS_PATH) => {
	if (!base) return null;
	return base.replace(/^http/, 'ws') + path;
};



export default function Page() {
	const [telemetry, setTelemetry] = useState<Telemetry>({});
	const [connection, setConnection] = useState('connecting');
	const wsRef = useRef<WebSocket | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const commandRef = useRef<ControlCommand>({
		roll: 0,
		pitch: 0,
		yaw: 0,
		altitude_delta: 0
	});

	useEffect(() => {
		const wsUrl = toWsUrl(serverUrl);
		if (!wsUrl) return;

		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => setConnection('open');
		ws.onclose = () => setConnection('closed');
		ws.onerror = () => setConnection('closed');

		ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				if (payload.type === 'telemetry') {
					setTelemetry(payload.data ?? {});
				}
				if (payload.type === 'hello') {
					setTelemetry(payload.telemetry ?? {});
				}
			} catch {
				// ignore malformed messages
			}
		};

		const interval = setInterval(() => {
			if (ws.readyState !== WebSocket.OPEN) return;
			ws.send(
				JSON.stringify({
					type: 'control',
					command: commandRef.current
				})
			);
		}, 100);

		return () => {
			clearInterval(interval);
			ws.close();
		};
	}, []);



	useEffect(() => {
		const rtcUrl = toWsUrl(serverUrl, RTC_PATH);
		if (!rtcUrl) return;

		const iceServers = RTC_ICE_SERVERS
			? JSON.parse(RTC_ICE_SERVERS)
			: [{ urls: 'stun:stun.l.google.com:19302' }];

		const ws = new WebSocket(rtcUrl);
		const pc = new RTCPeerConnection({ iceServers });
		pc.addTransceiver('video', { direction: 'recvonly' });

		pc.ontrack = (event) => {
			const [stream] = event.streams;
			if (videoRef.current && stream) {
				videoRef.current.srcObject = stream;
			}
		};

		pc.onicecandidate = (event) => {
			if (!event.candidate) return;
			ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate }));
		};

		ws.onmessage = async (event) => {
			try {
				const payload = JSON.parse(event.data);
				if (payload.type === 'answer') {
					await pc.setRemoteDescription(
						new RTCSessionDescription({
							sdp: payload.sdp,
							type: payload.sdpType ?? 'answer'
						})
					);
				}
				if (payload.type === 'ice' && payload.candidate) {
					await pc.addIceCandidate(payload.candidate);
				}
			} catch {
				// ignore malformed messages
			}
		};

		ws.onopen = async () => {
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			ws.send(
				JSON.stringify({
					type: 'offer',
					sdp: offer.sdp,
					sdpType: offer.type
				})
			);
		};

		return () => {
			ws.close();
			pc.close();
		};
	}, []);

	const updateCommand = (next: Partial<ControlCommand>) => {
		commandRef.current = {
			...commandRef.current,
			...next
		};
	};

	const sendOnce = (command: Partial<ControlCommand>) => {
		updateCommand(command);
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'control', command: commandRef.current }));
		}
		if (command.altitude_delta) {
			commandRef.current.altitude_delta = 0;
		}
	};

	return (
		<div
			className={`${bodyFont.className} min-h-screen bg-[#0d0e10] text-white`}
			style={{
				backgroundImage:
					'radial-gradient(circle at top left, rgba(255,170,90,0.25), transparent 40%), radial-gradient(circle at 20% 80%, rgba(80,200,200,0.2), transparent 40%), linear-gradient(160deg, #0c0f12 10%, #11161d 40%, #151c22 100%)'
			}}
		>
			<div className="mx-auto max-w-6xl px-6 py-10">
				<header className="flex flex-col gap-2">
					<p className="text-sm tracking-[0.4em] text-white/60 uppercase">
						Drone Ops Console
					</p>
					<h1 className={`${headingFont.className} text-4xl md:text-5xl`}>
						Mavic Control Deck
					</h1>
					<div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-white/70">
						<span className="rounded-full border border-white/20 px-3 py-1">
							WebSocket: {connection}
						</span>
						<span className="rounded-full border border-white/20 px-3 py-1">
							Telemetry:{' '}
							{telemetry.time ? `${telemetry.time.toFixed(1)}s` : '--'}
						</span>
					</div>
				</header>

				<main className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
					<section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
						<div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
							<div>
								<p className="text-xs tracking-[0.3em] text-white/50 uppercase">
									Control
								</p>
								<h2 className={`${headingFont.className} text-2xl`}>
									Manual Flight
								</h2>
							</div>
							<div className="text-sm text-white/60">
								Roll: {commandRef.current.roll.toFixed(2)} | Pitch:{' '}
								{commandRef.current.pitch.toFixed(2)}
							</div>
						</div>

						<div className="mt-8 grid gap-6 md:grid-cols-[200px_1fr]">
							<div className="flex flex-col items-center gap-4">
								<div className="grid grid-cols-3 gap-3">
									<button
										className="col-start-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
										onPointerDown={() => updateCommand({ pitch: -2.0 })}
										onPointerUp={() => updateCommand({ pitch: 0 })}
									>
										Forward
									</button>
									<button
										className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
										onPointerDown={() => updateCommand({ roll: -1.0 })}
										onPointerUp={() => updateCommand({ roll: 0 })}
									>
										Left
									</button>
									<button
										className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
										onPointerDown={() => updateCommand({ roll: 1.0 })}
										onPointerUp={() => updateCommand({ roll: 0 })}
									>
										Right
									</button>
									<button
										className="col-start-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
										onPointerDown={() => updateCommand({ pitch: 2.0 })}
										onPointerUp={() => updateCommand({ pitch: 0 })}
									>
										Back
									</button>
								</div>
							</div>

							<div className="flex flex-col gap-6">
								<div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-5">
									<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
										Altitude
									</p>
									<div className="mt-3 flex items-center justify-between">
										<span className={`${headingFont.className} text-3xl`}>
											{telemetry.altitude
												? telemetry.altitude.toFixed(2)
												: '--'}{' '}
											m
										</span>
										<div className="flex gap-2">
											<button
												className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
												onClick={() => sendOnce({ altitude_delta: 0.2 })}
											>
												Up
											</button>
											<button
												className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
												onClick={() => sendOnce({ altitude_delta: -0.2 })}
											>
												Down
											</button>
										</div>
									</div>
									<p className="mt-2 text-xs text-white/60">
										Target:{' '}
										{telemetry.target_altitude
											? telemetry.target_altitude.toFixed(2)
											: '--'}{' '}
										m
									</p>
								</div>

								<div className="rounded-2xl border border-white/10 bg-white/5 p-5">
									<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
										Orientation
									</p>
									<div className="mt-4 grid grid-cols-3 gap-3 text-sm">
										<div>
											<p className="text-white/50">Roll</p>
											<p>{telemetry.roll?.toFixed(3) ?? '--'}</p>
										</div>
										<div>
											<p className="text-white/50">Pitch</p>
											<p>{telemetry.pitch?.toFixed(3) ?? '--'}</p>
										</div>
										<div>
											<p className="text-white/50">Yaw</p>
											<p>{telemetry.yaw?.toFixed(3) ?? '--'}</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					</section>

					<section className="flex flex-col gap-6">
						<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
							<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
								Camera
							</p>
							<div className="mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
								{serverUrl ? (
									<video
										ref={videoRef}
										autoPlay
										playsInline
										muted
										className="h-full w-full object-cover"
									/>
								) : (
									<div className="flex h-full items-center justify-center text-sm text-white/60">
										Camera feed unavailable
									</div>
								)}
							</div>
						</div>

						<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
							<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
								3D Point Cloud
							</p>
							<div className="mt-4 aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
								<PointCloudViewer style={{ width: '100%', height: '100%' }} />
							</div>
						</div>

						<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
							<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
								GPS
							</p>
							<div className="mt-4 grid grid-cols-3 gap-4 text-sm">
								<div>
									<p className="text-white/50">X</p>
									<p>{telemetry.x?.toFixed(2) ?? '--'}</p>
								</div>
								<div>
									<p className="text-white/50">Y</p>
									<p>{telemetry.y?.toFixed(2) ?? '--'}</p>
								</div>
								<div>
									<p className="text-white/50">Z</p>
									<p>{telemetry.z?.toFixed(2) ?? '--'}</p>
								</div>
							</div>
						</div>

						<div className="rounded-3xl border border-white/10 bg-white/5 p-6">
							<p className="text-xs tracking-[0.25em] text-white/50 uppercase">
								Angular Velocity
							</p>
							<div className="mt-4 grid grid-cols-2 gap-4 text-sm">
								<div>
									<p className="text-white/50">Roll Rate</p>
									<p>{telemetry.roll_velocity?.toFixed(3) ?? '--'}</p>
								</div>
								<div>
									<p className="text-white/50">Pitch Rate</p>
									<p>{telemetry.pitch_velocity?.toFixed(3) ?? '--'}</p>
								</div>
							</div>
						</div>
					</section>
				</main>
			</div>
		</div>
	);
}
