import { ArkErrors, type } from "arktype";

export type ServerStatuses = 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown' | 'inactive';

export type Server =
{
	id: number,
	name: string | number,
	status: ServerStatuses, 
	snapshots: {id: number, date: string, disk: number, architecture: 'x86' | 'arm'}[],
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
	snapshot_id?: number,
	location: string,
	type: string,
	ssh_keys: string[],
	ipv4: string, 
	ipv6: string,
};

export type PrimaryIP = 
{
	ip: string,
	id: number,
	name: string,
	type: 'ipv4' | 'ipv6',
	assigned: number | false,
	location: string,
	auto_delete: boolean
};

export type ServerType =
{
	name: string, 
	cores: number, 
	memory: number,
	disk: number,
	hourly_price: number,
	monthly_price: number,
	architecture: 'x86' | 'arm'
}

export const OSImage = type(
	{
		id: "number",
		name: "string",
		description: "string",
		disk_size: "number",
		type: "'system' | 'app'",
		os_flavor: "'ubuntu' | 'centos' | 'debian' | 'fedora' | 'rocky' | 'alma' | 'opensuse' | 'unknown'",
		os_version: "string | null",
		architecture: "'x86' | 'arm'"
	}	
);
export type OSImage = typeof OSImage.infer;