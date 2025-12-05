import { read_server_list } from './configs';
import { log_error, error_to_string } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types } from './api_calls';
import { ServerList } from './types';

export async function generate_server_list()
{
	let running_servers;
	let snapshots;

	try
	{
		[running_servers, snapshots] = await Promise.all(
			[
				get_running_servers(),
				get_snapshots()
			]
		);
	}
	catch (error)
	{
		throw error;
	}

	const servers: ServerList = new Map();

	for(const server of running_servers)
	{
		servers.set(server.name, {id: server.id, status: 'running', snapshots: [], cores: server.cores, disk: server.disk, memory: server.memory});
	}

	for(const snapshot of snapshots)
	{
		const existing_server = servers.get(snapshot.name);

		if(!existing_server)
		{
			servers.set(snapshot.name, {id: snapshot.id, status: 'inactive', snapshots: [{id: snapshot.id}], disk: snapshot.disk});
			continue;
		}

		servers.set(
			snapshot.name, 
			{
				id: snapshot.id, // Hetzner sorts the snapshots from oldest to newest, so the latest one should be used here
				status: existing_server.status, 
				snapshots: [...existing_server.snapshots, {id: snapshot.id}],
				disk: snapshot.disk
			}
		);
		
	}

	return servers;
}