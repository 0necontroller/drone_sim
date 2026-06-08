import { useEffect, useRef } from 'react';
import { serverUrl } from '@/lib/config';

const RTC_PATH = '/api/v1/drone/rtc';
const RTC_ICE_SERVERS = process.env.NEXT_PUBLIC_RTC_ICE_SERVERS;

const toWsUrl = (base?: string, path = RTC_PATH) => {
	if (!base) return null;
	return base.replace(/^http/, 'ws') + path;
};

interface CameraFeedProps {
	className?: string;
}

export default function CameraFeed({ className = '' }: CameraFeedProps) {
	const videoRef = useRef<HTMLVideoElement | null>(null);

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
							type: payload.sdpType ?? 'answer',
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
					sdpType: offer.type,
				})
			);
		};

		return () => {
			ws.close();
			pc.close();
		};
	}, []);

	if (!serverUrl) {
		return (
			<div className={`flex items-center justify-center bg-slate-950 ${className}`}>
				<div className="text-center">
					<div className="mb-3 text-4xl opacity-30">📷</div>
					<p className="text-sm font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
						Camera feed unavailable
					</p>
				</div>
			</div>
		);
	}

	return (
		<video
			ref={videoRef}
			autoPlay
			playsInline
			muted
			className={className}
			style={{ objectFit: 'cover' }}
		/>
	);
}
