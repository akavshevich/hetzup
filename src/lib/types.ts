export type ServerStatuses = 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown' | 'inactive';

export type Server =
{
	id: number,
	name: string | number,
	status: ServerStatuses, 
	snapshots: {id: number, date: string, disk: number}[],
	cores?: number,
	disk: number,
	memory?: number,
	type?: string,
	ipv4?: string, 
	ipv6?: string,
	location?: string
};

export type ServerList = Map< string | number, Server >;
export type NewServerDetails = {id: number, ipv4?: string, ipv6?: string, status: ServerStatuses, root_password?: string};

export type NewServerConfig = 
{
	name: string | number,
	snapshot?: {id: number, date: string, disk: number},
	location: 'string',
	type: 'string',
	ssh_keys: string[]
};