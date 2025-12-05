import { read_server_list } from './configs';
import { log_error, error_to_string } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types } from './api_calls';

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

	const servers: Map<string, {id: number, type: 'server' | 'snapshot'}> = new Map();

	for(const server of running_servers)
	{
		servers.set(server.name, {id: server.id, type: 'server'});
	}

	for(const snapshot of snapshots)
	{
		if(!servers.has(snapshot.name))
		{
			servers.set(snapshot.name, {id: snapshot.id, type: 'snapshot'});
		}
	}

	return servers;
}