import { useEffect, useRef } from 'react';
import { serverUrl } from '@/lib/config';

const RTC_PATH = '/api/v1/drone/rtc';
const RTC_ICE_SERVERS = process.env.NEXT_PUBLIC_RTC_ICE_SERVERS;

const toWsUrl = (base?: string, path = RTC_PATH) => {
	if (!base) return null;
	return base.replace(/^http/, 'ws') + path;
};

export default function CameraFeed() {
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

	return (
		<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm h-full flex flex-col">
			<p className="text-xs tracking-[0.2em] text-gray-400 uppercase font-semibold mb-4">
				Camera
			</p>
			<div className="flex-1 w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-center min-h-[300px]">
				{serverUrl ? (
					<video
						ref={videoRef}
						autoPlay
						playsInline
						muted
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-gray-400">
						Camera feed unavailable
					</div>
				)}
			</div>
		</div>
	);
}
