import ora from 'ora';

import { read_server_list } from './configs';
import { log_error, error_to_string } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, get_snapshot, delete_server } from './api_calls';
import { Server, ServerList } from './types';

export async function generate_server_list(): Promise< ServerList >
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
		servers.set(
			server.name, 
			{id: server.id, name: server.name, status: 'running', snapshots: [], cores: server.cores, disk: server.disk, memory: server.memory}
		);
	}

	for(const snapshot of snapshots)
	{
		const existing_server = servers.get(snapshot.name);

		if(!existing_server)
		{
			servers.set(
				snapshot.name, 
				{id: snapshot.id, name: snapshot.name, status: 'inactive', snapshots: [{id: snapshot.id}], disk: snapshot.disk}
			);
			continue;
		}

		const updated_server_details: Server = 
		{
			id: existing_server.id,
			name: existing_server.name,
			status: existing_server.status, 
			snapshots: [...existing_server.snapshots, {id: snapshot.id}],
			disk: existing_server.disk
		};

		if(existing_server.status === 'inactive')
		{
			updated_server_details.id = snapshot.id; // Hetzner sorts the snapshots from oldest to newest, that way the latest will be here
			updated_server_details.disk = snapshot.disk;
		}
		else
		{
			updated_server_details.cores = existing_server.cores;
			updated_server_details.memory = existing_server.memory;
		}

		servers.set(
			snapshot.name, 
			updated_server_details
		);
		
	}

	return servers;
}

export async function save_server_to_snapshot(server: Server): Promise< void >
{
	try
	{
		const init_spinner = ora({text: 'Initializing new snapshot...', spinner: 'point', color: 'cyan'}).start();
		const new_snapshot_id = await initialize_snapshot_save(server);
		init_spinner.stop();

		const check_spinner = ora({text: 'Saving server to snapshot...', spinner: 'point', color: 'green'}).start();

		return new Promise(
			function (resolve)
			{
				const check_on_snapshot = setInterval(
					async function ()
					{
						const snapshot_details = await get_snapshot(new_snapshot_id);
						if(snapshot_details.status !== 'available')
						{
							return;
						}

						clearInterval(check_on_snapshot);
						check_spinner.stop();
						resolve();
					},
					2000
				);
			}
		);
	}
	catch (error)
	{
		throw new Error(error_to_string(error));
	}
}

export async function stop_server(server: Server, mode: 'save_stop' | 'stop' = 'save_stop')
{
	const stop_server_spinner = ora({text: 'Stopping server...', spinner: 'point', color: 'red'});

	try
	{
		if(mode === 'save_stop')
		{
			await save_server_to_snapshot(server);
		}

		stop_server_spinner.start();
		await delete_server(server);
		stop_server_spinner.stop();
	}
	catch (error) 
	{
		stop_server_spinner.stop();
		throw new Error(error_to_string(error));
	}
}