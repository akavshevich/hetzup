export type Server =
{
	id: number,
	name: string | number,
	status: 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown' | 'inactive', 
	snapshots: {id: number}[],
	cores?: number,
	disk: number,
	memory?: number
};

export type ServerList = Map< string | number, Server >;

