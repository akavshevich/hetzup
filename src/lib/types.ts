export type ServerStatuses = 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown' | 'inactive';

export type Server =
{
	id: number,
	name: string | number,
	status: ServerStatuses, 
	snapshots: {id: number}[],
	cores?: number,
	disk: number,
	memory?: number
};

export type ServerList = Map< string | number, Server >;
export type NewServerDetails = {id: number, ipv4: string, ipv6: string, status: ServerStatuses};