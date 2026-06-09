'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/* ─────────────────────────────────────────────────────────────────────────────
   COORDINATE SYSTEM NOTES
   ─────────────────────────────────────────────────────────────────────────────
   Webots uses ENU (East-North-Up):
     • GPS:  X = East, Y = North/up altitude, Z = "depth" (from Webots perspective)
             Actually in Webots Mavic: X = world-right, Y = altitude, Z = world-fwd
     • IMU:  roll, pitch, yaw (radians) – roll/pitch from levelled, yaw CCW from North
     • LiDAR points are in the *drone body frame*: X=fwd, Y=left, Z=up

   Three.js uses Y-up right-handed (same as OpenGL):
     • We map Webots(X→East, Z→South, Y→up) to Three.js(X→East, Y→up, Z→South)
     i.e. three_x = webots_x, three_y = webots_y (altitude), three_z = -webots_z

   Drone body → World transform:
     Apply R_yaw * R_pitch * R_roll to the sensor-local point, then translate by GPS.
     Yaw is around the vertical (Y in Three.js / Y in Webots), CCW positive.
   ────────────────────────────────────────────────────────────────────────────── */

const MAX_WORLD_POINTS = 200_000;

/** 6-DOF drone pose from a single LiDAR scan frame */
interface DronePose {
	x: number;     // metres (Webots X / Three.js X)
	y: number;     // metres altitude (Webots Y / Three.js Y)
	z: number;     // metres (Webots Z / Three.js -Z)
	roll: number;  // radians
	pitch: number; // radians
	yaw: number;   // radians
}

/* ─── Height-based colouring: blue → cyan → green → yellow → red ─────────── */
function heightColor(alt: number, minAlt: number, maxAlt: number): [number, number, number] {
	const range = maxAlt - minAlt || 1;
	const t = Math.max(0, Math.min(1, (alt - minAlt) / range));

	if (t < 0.25) {
		const s = t / 0.25;
		return [0, s, 1];
	} else if (t < 0.5) {
		const s = (t - 0.25) / 0.25;
		return [0, 1, 1 - s];
	} else if (t < 0.75) {
		const s = (t - 0.5) / 0.25;
		return [s, 1, 0];
	} else {
		const s = (t - 0.75) / 0.25;
		return [1, 1 - s, 0];
	}
}

/* ─── Transform a drone-body-frame point to world frame ──────────────────── */
function bodyToWorld(
	bx: number, by: number, bz: number,
	pose: DronePose,
): [number, number, number] {
	const { roll: r, pitch: p, yaw: y } = pose;

	// Rotation matrices (intrinsic Tait-Bryan, applied as yaw→pitch→roll)
	// Roll around X (body fwd axis in Webots body frame)
	const cr = Math.cos(r), sr = Math.sin(r);
	// Pitch around Y (body lateral)
	const cp = Math.cos(p), sp = Math.sin(p);
	// Yaw around Z (up)
	const cy = Math.cos(y), sy = Math.sin(y);

	// Combined rotation R = Rz(yaw) * Ry(pitch) * Rx(roll)
	// Applied to the point column-vector
	// First Rx (roll around x):
	const ax = bx;
	const ay = by * cr - bz * sr;
	const az = by * sr + bz * cr;

	// Then Ry (pitch around y):
	const bx2 = ax * cp + az * sp;
	const by2 = ay;
	const bz2 = -ax * sp + az * cp;

	// Then Rz (yaw around z):
	const wx = bx2 * cy - by2 * sy;
	const wy = bx2 * sy + by2 * cy;
	const wz = bz2;

	// Translate to world (add GPS position)
	// Webots GPS: [x, y, z] where y = altitude, z = depth/south
	// Three.js: x = wx, y = altitude (wy from Webots y), z = -wz (flip Webots Z)
	return [
		wx + pose.x,    // Three.js X
		wz + pose.y,    // Three.js Y = altitude (Webots body Z → up + GPS altitude)
		-(wy + pose.z), // Three.js Z = -Webots Z
	];
}

/* ─── Shared store – avoids React state for the hot path ─────────────────── */
type WorldPoint = [number, number, number]; // [three_x, three_y, three_z]
type PointStore = { points: WorldPoint[]; dirty: boolean };

/* ─── Point cloud mesh ─────────────────────────────────────────────────────── */
function PointCloudMesh({ store }: { store: React.MutableRefObject<PointStore> }) {
	const geomRef = useRef<THREE.BufferGeometry>(null);

	useFrame(() => {
		if (!store.current.dirty || !geomRef.current) return;
		store.current.dirty = false;

		const pts = store.current.points;
		if (!pts.length) {
			geomRef.current.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
			geomRef.current.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
			return;
		}

		// Find altitude range for colour mapping
		let minY = Infinity, maxY = -Infinity;
		for (const [, y] of pts) {
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}

		const positions = new Float32Array(pts.length * 3);
		const colors = new Float32Array(pts.length * 3);

		for (let i = 0; i < pts.length; i++) {
			const [x, y, z] = pts[i];
			positions[i * 3] = x;
			positions[i * 3 + 1] = y;
			positions[i * 3 + 2] = z;
			const [r, g, b] = heightColor(y, minY, maxY);
			colors[i * 3] = r;
			colors[i * 3 + 1] = g;
			colors[i * 3 + 2] = b;
		}

		geomRef.current.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geomRef.current.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geomRef.current.computeBoundingSphere();
	});

	return (
		<points frustumCulled={false}>
			<bufferGeometry ref={geomRef} />
			<pointsMaterial
				size={0.08}
				vertexColors
				sizeAttenuation
				transparent
				opacity={0.85}
				depthWrite={false}
			/>
		</points>
	);
}

/* ─── Drone marker (follows telemetry, not anchored to origin) ──────────── */
function DroneMarker({ pose }: { pose: DronePose | null }) {
	const ref = useRef<THREE.Group>(null);

	useFrame((_, delta) => {
		if (!ref.current) return;
		ref.current.rotation.y += delta * 1.5;
		if (pose) {
			ref.current.position.set(pose.x, pose.y, -pose.z);
		}
	});

	return (
		<group ref={ref}>
			<mesh>
				<octahedronGeometry args={[0.25, 0]} />
				<meshBasicMaterial color="#ff6b35" transparent opacity={0.9} />
			</mesh>
			<mesh rotation={[-Math.PI / 2, 0, 0]}>
				<ringGeometry args={[0.3, 0.4, 32]} />
				<meshBasicMaterial color="#ff6b35" transparent opacity={0.3} side={THREE.DoubleSide} />
			</mesh>
		</group>
	);
}

/* ─── Infinite ground grid ───────────────────────────────────────────────── */
function SceneGrid() {
	return <gridHelper args={[200, 200, '#1a3a4a', '#0e1e28']} position={[0, 0, 0]} />;
}

/* ─── North / East axis arrows ──────────────────────────────────────────── */
function AxesHint() {
	return (
		<>
			{/* X = East (red) */}
			<arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.05, 0), 3, '#ef4444', 0.4, 0.2]} />
			{/* Z = South (blue) — in Three.js +Z is towards viewer */}
			<arrowHelper args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, 0), 3, '#3b82f6', 0.4, 0.2]} />
			{/* Y = Up (green) */}
			<arrowHelper args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.05, 0), 3, '#22c55e', 0.4, 0.2]} />
		</>
	);
}

/* ─── Scene (never re-renders from parent state changes) ─────────────────── */
const Scene = ({
	store,
	pose,
}: {
	store: React.MutableRefObject<PointStore>;
	pose: React.MutableRefObject<DronePose | null>;
}) => {
	// Expose a mutable ref snapshot to DroneMarker without React state
	const [poseCopy, setPoseCopy] = useState<DronePose | null>(null);
	useEffect(() => {
		const id = setInterval(() => {
			if (pose.current !== poseCopy) setPoseCopy(pose.current ? { ...pose.current } : null);
		}, 100);
		return () => clearInterval(id);
	});

	return (
		<>
			<ambientLight intensity={0.4} />
			<directionalLight position={[20, 40, 20]} intensity={0.5} />
			<SceneGrid />
			<AxesHint />
			<DroneMarker pose={poseCopy} />
			<PointCloudMesh store={store} />
			<OrbitControls
				enableDamping
				dampingFactor={0.1}
				minDistance={1}
				maxDistance={400}
				maxPolarAngle={Math.PI * 0.9}
			/>
		</>
	);
};

/* ─── Main exported component ─────────────────────────────────────────────── */
export default function PointCloudViewer({
	className,
	style,
}: {
	className?: string;
	style?: React.CSSProperties;
}) {
	const storeRef = useRef<PointStore>({ points: [], dirty: false });
	const poseRef = useRef<DronePose | null>(null);

	const [pointCount, setPointCount] = useState(0);
	const [connected, setConnected] = useState(false);
	const [frameCount, setFrameCount] = useState(0);

	const clearPoints = useCallback(() => {
		storeRef.current.points = [];
		storeRef.current.dirty = true;
		setPointCount(0);
	}, []);

	/* Throttled HUD counter */
	useEffect(() => {
		const id = setInterval(() => setPointCount(storeRef.current.points.length), 500);
		return () => clearInterval(id);
	}, []);

	/* WebSocket – receive pointcloud frames with drone pose */
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
					const payload = JSON.parse(event.data as string);

					if (payload.type === 'pointcloud' && Array.isArray(payload.points)) {
						const pose: DronePose | null = payload.pose ?? null;

						// Keep latest pose for the drone marker
						if (pose) poseRef.current = pose;

						const rawPoints: [number, number, number][] = payload.points;
						const store = storeRef.current;

						if (pose) {
							// ── World-space projection ──────────────────────────────────
							// Each point is in the LiDAR sensor frame (≈ drone body frame).
							// In Webots' Mavic, the LiDAR is body-frame:
							//   p.x = forward, p.y = left, p.z = up (relative to drone)
							// Apply roll/pitch/yaw rotation then GPS translation.
							const newWorldPoints: WorldPoint[] = [];
							for (const [bx, by, bz] of rawPoints) {
								const wp = bodyToWorld(bx, by, bz, pose);
								// Skip points that are clearly the drone chassis or at drone height
								// (within 0.3m of the drone — artefact)
								const dx = wp[0] - pose.x;
								const dz = wp[2] - (-pose.z);
								const horiz2 = dx * dx + dz * dz;
								if (horiz2 < 0.09) continue; // < 0.3m horizontal → skip
								newWorldPoints.push(wp);
							}

							const combined = [...store.points, ...newWorldPoints];
							store.points =
								combined.length > MAX_WORLD_POINTS
									? combined.slice(combined.length - MAX_WORLD_POINTS)
									: combined;
						} else {
							// Fallback: no pose data yet — store in sensor frame (old behaviour)
							const fallback: WorldPoint[] = rawPoints.map(([x, y, z]) => [x, z, -y]);
							const combined = [...store.points, ...fallback];
							store.points =
								combined.length > MAX_WORLD_POINTS
									? combined.slice(combined.length - MAX_WORLD_POINTS)
									: combined;
						}

						store.dirty = true;
						setFrameCount((c) => c + 1);

					} else if (payload.type === 'telemetry') {
						// Also update pose from telemetry for drone marker continuity
						const d = payload.data ?? payload;
						if (typeof d.x === 'number' && typeof d.y === 'number') {
							poseRef.current = {
								x: d.x,
								y: d.z ?? (poseRef.current?.y ?? 0),
								z: d.y, // Webots GPS z is depth
								roll: d.roll ?? 0,
								pitch: d.pitch ?? 0,
								yaw: d.yaw ?? 0,
							};
						}
					}
				} catch {
					// ignore malformed
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
			{/* ── HUD overlay ─────────────────────────────────────────────────── */}
			<div
				style={{
					position: 'absolute', top: 12, left: 12, zIndex: 10,
					display: 'flex', gap: 8, alignItems: 'center',
				}}
			>
				<span
					style={{
						display: 'inline-flex', alignItems: 'center', gap: 6,
						fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
						color: 'rgba(255,255,255,0.6)',
						background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
						padding: '4px 10px', borderRadius: 999,
						border: '1px solid rgba(255,255,255,0.1)',
					}}
				>
					<span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#4ecdc4' : '#ff6b6b' }} />
					{pointCount.toLocaleString()} pts
				</span>
				<span
					style={{
						display: 'inline-flex', alignItems: 'center', gap: 6,
						fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
						color: 'rgba(255,255,255,0.5)',
						background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
						padding: '4px 10px', borderRadius: 999,
						border: '1px solid rgba(255,255,255,0.08)',
					}}
				>
					{frameCount} frames
				</span>
				<button
					onClick={clearPoints}
					style={{
						fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
						color: 'rgba(255,255,255,0.6)',
						background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
						padding: '4px 10px', borderRadius: 999,
						border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
					}}
				>
					Clear
				</button>
			</div>

			{/* ── Axis legend ─────────────────────────────────────────────────── */}
			<div
				style={{
					position: 'absolute', bottom: 12, right: 12, zIndex: 10,
					display: 'flex', flexDirection: 'column', gap: 3,
					fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
					background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
					padding: '6px 10px', borderRadius: 8,
					border: '1px solid rgba(255,255,255,0.08)',
				}}
			>
				{[['#ef4444', 'X East'], ['#3b82f6', 'Z South'], ['#22c55e', 'Y Up']].map(([c, l]) => (
					<div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.55)' }}>
						<span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
						{l}
					</div>
				))}
				<div style={{ color: 'rgba(255,255,255,0.3)', marginTop: 3, fontSize: 8 }}>WORLD FRAME</div>
			</div>

			<Canvas
				camera={{ position: [30, 20, 30], fov: 50, near: 0.1, far: 1000 }}
				style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}
				onCreated={({ scene, gl }) => {
					scene.background = new THREE.Color('#080c10');
					scene.fog = new THREE.FogExp2('#080c10', 0.008);
					gl.setClearColor('#080c10', 1);
				}}
			>
				<Scene store={storeRef} pose={poseRef} />
			</Canvas>
		</div>
	);
}
