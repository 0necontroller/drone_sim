export type Telemetry = {
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

export type ControlCommand = {
	roll: number;
	pitch: number;
	yaw: number;
	altitude_delta: number;
};
