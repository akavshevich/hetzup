import ora from 'ora';

import { read_server_list } from './configs';
import { log_error, error_to_string, sleep } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, get_snapshot, delete_server, spin_up_server, get_server, delete_snapshot, rebuild_server_from_image } from './api_calls';
import { NewServerDetails, Server, ServerList } from './types';
import { snapshot } from 'node:test';

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
				{id: snapshot.id, name: snapshot.name, status: 'inactive', snapshots: [{id: snapshot.id, date: snapshot.date, disk: snapshot.disk}], disk: snapshot.disk}
			);
			continue;
		}

		const updated_server_details: Server = 
		{
			id: existing_server.id,
			name: existing_server.name,
			status: existing_server.status, 
			snapshots: [...existing_server.snapshots, {id: snapshot.id, date: snapshot.date, disk: snapshot.disk}],
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
		const spinner = ora({text: `Initializing new snapshot for ${server.name}...`, spinner: 'point', color: 'cyan'}).start();
		const new_snapshot_id = await initialize_snapshot_save(server);

		spinner.color = 'green';
		spinner.text = `Saving ${server.name} to snapshot...`;

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
						spinner.stop();
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
	const stop_server_spinner = ora({text: `Stopping ${server.name}...`, spinner: 'point', color: 'red'});

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

export async function spin_up_from_snapshot(server: Server, type: string, latest: boolean = true, snapshot_id?: number): Promise< Server >
{
	if(server.status !== 'inactive')
	{
		throw new Error(`${server.name} is already running`);
	}

	if(latest || !snapshot_id)
	{
		snapshot_id = server.id;
	}

	try
	{
		const spinner = ora({text: `Initializing ${server.name}...`, spinner: 'point', color: 'cyan'}).start();
		const new_server_details = await spin_up_server(snapshot_id, server.name, type);

		return new Promise(
			function (resolve)
			{
				const check_on_server = setInterval(
					async function ()
					{
						const server_details = await get_server(new_server_details.id);
						
						if(server_details.status === 'starting')
						{
							spinner.color = 'green';
						}
						
						if(server_details.status !== 'running')
						{
							const capitalized_status = String(server_details.status).charAt(0).toUpperCase() + String(server_details.status).slice(1);
							spinner.text = `${capitalized_status} ${server.name}...`;
							return;
						}

						clearInterval(check_on_server);
						spinner.stop();
						resolve(server_details);
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

export async function delete_snapshot_visual(snapshot_id: number | string)
{
	try
	{
		const spinner = ora({text: 'Deleting snapshot...', spinner: 'point', color: 'red'}).start();
		await delete_snapshot(snapshot_id);
		spinner.stop();
	}
	catch (error)
	{
		throw new Error(error_to_string(error));
	}
}

export async function revert_to_snapshot(server: Server, snapshot_id: number | string): Promise<void>
{
	try
	{
		const spinner = ora({text: `Reverting ${server.name} to a previous snapshot...`, spinner: 'point', color: 'cyan'}).start();
		await rebuild_server_from_image(server, snapshot_id);

		return new Promise<void>(
			function (resolve)
			{
				const check_on_server = setInterval(
					async function ()
					{
						const server_details = await get_server(server.id);

						if(server_details.status !== 'running')
						{
							const capitalized_status = String(server_details.status).charAt(0).toUpperCase() + String(server_details.status).slice(1);
							spinner.text = `${capitalized_status} ${server.name}...`;
							return;
						}

						clearInterval(check_on_server);
						spinner.stop();
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

export async function complete_server_removal(server: Server)
{
	for (let index = 0; index < server.snapshots.length; index++)
	{
		const snapshot = server.snapshots[index];
		
	}
}