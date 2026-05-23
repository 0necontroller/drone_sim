'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

const MAX_ACCUMULATED_POINTS = 80_000;

/* ── Height-based color: blue → cyan → green → yellow → red ── */
function heightColor(z: number, minZ: number, maxZ: number): [number, number, number] {
	const range = maxZ - minZ || 1;
	const t = Math.max(0, Math.min(1, (z - minZ) / range));

	let r: number, g: number, b: number;
	if (t < 0.25) {
		const s = t / 0.25;
		r = 0;
		g = s;
		b = 1;
	} else if (t < 0.5) {
		const s = (t - 0.25) / 0.25;
		r = 0;
		g = 1;
		b = 1 - s;
	} else if (t < 0.75) {
		const s = (t - 0.5) / 0.25;
		r = s;
		g = 1;
		b = 0;
	} else {
		const s = (t - 0.75) / 0.25;
		r = 1;
		g = 1 - s;
		b = 0;
	}
	return [r, g, b];
}

/* ──────────────────────────────────────────────────────────────
   Shared refs that live OUTSIDE React state so updates never
   trigger Canvas re-renders.
   ────────────────────────────────────────────────────────────── */
type PointStore = {
	points: number[][];
	dirty: boolean;
};

/* ── Point cloud – reads from shared ref via useFrame (no re-renders) ── */
function PointCloudMesh({ store }: { store: React.MutableRefObject<PointStore> }) {
	const geomRef = useRef<THREE.BufferGeometry>(null);

	useFrame(() => {
		if (!store.current.dirty || !geomRef.current) return;
		store.current.dirty = false;

		const points = store.current.points;
		const geom = geomRef.current;

		if (!points.length) {
			geom.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
			geom.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
			return;
		}

		let minZ = Infinity;
		let maxZ = -Infinity;
		for (let i = 0; i < points.length; i++) {
			const z = points[i][2];
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}

		const positions = new Float32Array(points.length * 3);
		const colors = new Float32Array(points.length * 3);

		for (let i = 0; i < points.length; i++) {
			const [x, y, z] = points[i];
			positions[i * 3] = x;
			positions[i * 3 + 1] = z;
			positions[i * 3 + 2] = -y;

			const [r, g, b] = heightColor(z, minZ, maxZ);
			colors[i * 3] = r;
			colors[i * 3 + 1] = g;
			colors[i * 3 + 2] = b;
		}

		// Dispose old attributes before setting new ones
		const oldPos = geom.getAttribute('position');
		const oldCol = geom.getAttribute('color');
		if (oldPos) (oldPos as THREE.BufferAttribute).array = new Float32Array(0);
		if (oldCol) (oldCol as THREE.BufferAttribute).array = new Float32Array(0);

		geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geom.computeBoundingSphere();
	});

	return (
		<points frustumCulled={false}>
			<bufferGeometry ref={geomRef} />
			<pointsMaterial
				size={0.12}
				vertexColors
				sizeAttenuation
				transparent
				opacity={0.9}
				depthWrite={false}
			/>
		</points>
	);
}

/* ── Drone marker at origin ── */
function DroneMarker() {
	const ref = useRef<THREE.Group>(null);

	useFrame((_, delta) => {
		if (ref.current) {
			ref.current.rotation.y += delta * 1.5;
		}
	});

	return (
		<group position={[0, 0.15, 0]} ref={ref}>
			<mesh>
				<octahedronGeometry args={[0.2, 0]} />
				<meshBasicMaterial color="#ff6b35" transparent opacity={0.9} />
			</mesh>
			<mesh rotation={[-Math.PI / 2, 0, 0]}>
				<ringGeometry args={[0.25, 0.32, 32]} />
				<meshBasicMaterial color="#ff6b35" transparent opacity={0.3} side={THREE.DoubleSide} />
			</mesh>
		</group>
	);
}

/* ── Grid ── */
function SceneGrid() {
	return <gridHelper args={[60, 60, '#1a3a4a', '#0e1e28']} position={[0, -0.01, 0]} />;
}

/* ── The actual Three.js scene (never re-renders from parent state) ── */
const Scene = ({ store }: { store: React.MutableRefObject<PointStore> }) => {
	return (
		<>
			<ambientLight intensity={0.4} />
			<directionalLight position={[10, 20, 10]} intensity={0.6} />
			<SceneGrid />
			<DroneMarker />
			<PointCloudMesh store={store} />
			<OrbitControls
				enableDamping
				dampingFactor={0.12}
				minDistance={1}
				maxDistance={100}
				maxPolarAngle={Math.PI * 0.85}
			/>
		</>
	);
};

/* ── Main exported component ── */
export default function PointCloudViewer({
	className,
	style,
}: {
	className?: string;
	style?: React.CSSProperties;
}) {
	// Point data stored in a ref – never triggers Canvas re-renders
	const storeRef = useRef<PointStore>({ points: [], dirty: false });
	const [pointCount, setPointCount] = useState(0);
	const [connected, setConnected] = useState(false);
	const countTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

	const clearPoints = useCallback(() => {
		storeRef.current.points = [];
		storeRef.current.dirty = true;
		setPointCount(0);
	}, []);

	/* Periodically sync the point count to React state for the HUD
	   (throttled to avoid excessive re-renders) */
	useEffect(() => {
		countTimerRef.current = setInterval(() => {
			setPointCount(storeRef.current.points.length);
		}, 500);
		return () => clearInterval(countTimerRef.current);
	}, []);

	/* Connect to the dashboard WS to receive pointcloud broadcasts */
	useEffect(() => {
		const base = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:8001';
		const wsUrl = base.replace(/^http/, 'ws') + '/api/v1/drone/ws';

		let ws: WebSocket;
		let reconnectTimer: ReturnType<typeof setTimeout>;

		const connect = () => {
			ws = new WebSocket(wsUrl);

			ws.onopen = () => setConnected(true);
			ws.onclose = () => {
				setConnected(false);
				reconnectTimer = setTimeout(connect, 2000);
			};
			ws.onerror = () => ws.close();

			ws.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data);
					if (payload.type === 'pointcloud' && Array.isArray(payload.points)) {
						const store = storeRef.current;
						const combined = [...store.points, ...payload.points];
						store.points =
							combined.length > MAX_ACCUMULATED_POINTS
								? combined.slice(combined.length - MAX_ACCUMULATED_POINTS)
								: combined;
						store.dirty = true;
					}
				} catch {
					// ignore
				}
			};
		};

		connect();

		return () => {
			clearTimeout(reconnectTimer);
			ws?.close();
		};
	}, []);

	return (
		<div className={className} style={{ position: 'relative', ...style }}>
			{/* HUD overlay */}
			<div
				style={{
					position: 'absolute',
					top: 12,
					left: 12,
					zIndex: 10,
					display: 'flex',
					gap: 8,
					alignItems: 'center',
				}}
			>
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 6,
						fontSize: 11,
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
						color: 'rgba(255,255,255,0.6)',
						background: 'rgba(0,0,0,0.5)',
						backdropFilter: 'blur(8px)',
						padding: '4px 10px',
						borderRadius: 999,
						border: '1px solid rgba(255,255,255,0.1)',
					}}
				>
					<span
						style={{
							width: 6,
							height: 6,
							borderRadius: '50%',
							background: connected ? '#4ecdc4' : '#ff6b6b',
						}}
					/>
					{pointCount.toLocaleString()} pts
				</span>
				<button
					onClick={clearPoints}
					style={{
						fontSize: 11,
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
						color: 'rgba(255,255,255,0.6)',
						background: 'rgba(0,0,0,0.5)',
						backdropFilter: 'blur(8px)',
						padding: '4px 10px',
						borderRadius: 999,
						border: '1px solid rgba(255,255,255,0.1)',
						cursor: 'pointer',
					}}
				>
					Clear
				</button>
			</div>

			<Canvas
				camera={{ position: [10, 8, 10], fov: 55, near: 0.1, far: 300 }}
				style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}
				onCreated={({ scene, gl }) => {
					scene.background = new THREE.Color('#080c10');
					scene.fog = new THREE.Fog('#080c10', 40, 80);
					gl.setClearColor('#080c10', 1);
				}}
			>
				<Scene store={storeRef} />
			</Canvas>
		</div>
	);
}
