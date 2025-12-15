import axios from 'axios';
import { ArkErrors, type } from "arktype";

import { read_hetzner_config } from "./configs";
import { log_error, error_to_string } from "./utils";
import { NewServerDetails, Server } from "./types";

const APIResponse = type.or({"successful": "true", "response": "object"}, {"successful": "false", "error": "string"});
type APIResponse = typeof APIResponse.infer;

type APIMethod = 'GET' | 'POST' | 'DELETE';
type APIFields = {[index: string]: any};

async function call_hetzner_api(path: string, method: APIMethod, fields: APIFields = {}, page: false | number = false): Promise<APIResponse>
{
	const hetzner_config = read_hetzner_config();

	if(!hetzner_config || hetzner_config.api_token === '')
	{
		throw new Error('API key not found. Restart the program to reconfigure.');
	}

	let request = 
	{
		method: method,
		maxBodyLength: Infinity,
		url: 'https://api.hetzner.cloud/v1/' + path,
		headers:
		{ 
			'Authorization': 'Bearer ' + hetzner_config.api_token
		},
		params: {} as Record<string | number, string | number>,
		data: {}
	};

	if(method === 'POST')
	{
		request.data = fields;
	}
	else
	{
		request.params = fields;
	}

	if(page)
	{
		request.params.page = page;
	}

	try 
	{
		const response = await axios.request(request);

		if(typeof response.data.meta === 'undefined' 
			|| typeof response.data.meta.pagination === 'undefined' 
			|| typeof response.data.meta.pagination.next_page !== 'number')
		{
			return {successful: true, response: response.data};
		}

		const next_page_call = await call_hetzner_api(path, method, fields, response.data.meta.pagination.next_page);

		if(next_page_call.successful === false)
		{
			return {successful: false, error: error_to_string(next_page_call.error)};
		}

		const next_pages_data = next_page_call.response as {[index: string]: any};

		let paginated_prop_name = '';
		for(const prop in next_pages_data)
		{
			if(prop !== 'meta' && Array.isArray(next_pages_data[prop]))
			{
				paginated_prop_name = prop;
			}
		}

		if(paginated_prop_name === '')
		{
			return {successful: false, error: 'Paginated array not found on page ' + page.toString()};
		}

		if(Array.isArray(response.data[paginated_prop_name]) === false)
		{
			return {successful: false, error: 'Conflicting paginated prop names'};
		}

		response.data[paginated_prop_name] = [...response.data[paginated_prop_name], ...next_pages_data[paginated_prop_name]];
		return {successful: true, response: response.data};
	} 
	catch (error) 
	{
		return {successful: false, error: error_to_string(error)};
	}
}

type RunningServer = {id: number, name: string, cores: number, disk: number, memory: number};

const ServerAPIStructure = type(
	{
		id: "number",
		name: "string",
		status: "'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown'",
		server_type:
		{
			cores: "number",
			disk: "number",
			memory: "number"
		},
		public_net:
		{
			ipv4:
			{
				ip: "string"
			},
			ipv6:
			{
				ip: "string"
			}
		}
	}
);
type ServerAPIStructure = typeof ServerAPIStructure.infer;

const ServersAPIStructure = type(
	{
		response:
		{
			servers: type(ServerAPIStructure, "[]")
		}
	}
);
type ServersAPIStructure = typeof ServersAPIStructure.infer;

const ServersAPIResponse = type.and(APIResponse, ServersAPIStructure);
type ServersAPIResponse = typeof ServersAPIResponse.infer;

export async function get_running_servers(): Promise<RunningServer[]>
{
	const call = ServersAPIResponse(await call_hetzner_api('servers', 'GET'));

	if(call instanceof type.errors)
	{
		throw new Error('Unexpected API response for server list: ' + call.summary);
	}
	
	if(call.successful)
	{
		const response = call.response;
		const servers = [];

		for (const server of response.servers)
		{
			servers.push(
				{id: server.id, name: server.name, cores: server.server_type.cores, disk: server.server_type.disk, memory: server.server_type.memory}
			);
		}

		return servers;
	}
	else
	{
		throw new Error('Failed to call API to get a server list: ' + call.error);
	}
}

const SnapshotsAPIStructure = type({images: type({id: "number", created: "string", created_from: {name: "string"}, image_size: "number"}, "[]")});
type SnapshotsAPIStructure = typeof SnapshotsAPIStructure.infer;

export async function get_snapshots(): Promise<{id: number, name: string, date: string, disk: number}[]>
{
	const call = await call_hetzner_api('images', 'GET', {type: 'snapshot'});

	if(call.successful)
	{
		const response = SnapshotsAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for snapshot list: ' + response.summary);
		}

		const snapshots = [];
		for (const image of response.images)
		{
			snapshots.push({id: image.id, name: image.created_from.name, date: image.created, disk: image.image_size})
		}

		return snapshots;
	}
	else
	{
		throw new Error('Failed to call API to get a snapshot list: ' + call.error);
	}
}

type ServerType =
{
	name: string, 
	cores: number, 
	memory: number,
	disk: number,
	hourly_price: number,
	monthly_price: number
}

const ServerTypesAPIStructure = type(
	{
		server_types: 
		type({
			name: "string", 
			cores: "number", 
			memory: "number",
			disk: "number",
			prices: type({location: "string", price_hourly: {gross: "number"}, price_monthly: {gross: "number"}}, "[]")
		}, "[]")
	}
);
type ServerTypesAPIStructure = typeof ServerTypesAPIStructure.infer;

export async function get_available_server_types(): Promise<ServerType[]>
{
	const call = await call_hetzner_api('server_types', 'GET');

	if(call.successful)
	{
		const response = ServerTypesAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for server type list: ' + response.summary);
		}

		const hetzner_config = read_hetzner_config();

		let preferred_location = 'fsn1';
		if(hetzner_config && hetzner_config.preferred_location && hetzner_config.preferred_location !== '')
		{
			preferred_location = hetzner_config.preferred_location;
		}

		const server_types = [];
		for (const server_type of response.server_types)
		{
			let hourly_price = 0;
			let monthly_price = 0;

			for (const location of server_type.prices)
			{
				if(location.location === preferred_location)
				{
					hourly_price = location.price_hourly.gross;
					monthly_price = location.price_monthly.gross;
				}
			}

			if(hourly_price === 0 || monthly_price === 0)
			{
				continue;
			}

			server_types.push(
				{
					name: server_type.name, 
					cores: server_type.cores, 
					memory: server_type.memory,
					disk: server_type.disk,
					hourly_price: hourly_price,
					monthly_price: monthly_price
				}
			);
		}

		return server_types;
	}
	else
	{
		throw new Error('Failed to call API to get a server type list: ' + call.error);
	}
}

const SnapshotDetails = type(
	{
		id: "number",
		status: "'available' | 'creating' | 'unavailable'"
	}
);

type SnapshotDetails = typeof SnapshotDetails.infer;

const SnapshotDetailsAPIStructure = type(
	{
		response: 
		{
			image: SnapshotDetails
		}
	}
);
type SnapshotDetailsAPIStructure = typeof SnapshotDetailsAPIStructure.infer;

const SnapshotDetailsAPIResponse = type.and(APIResponse, SnapshotDetailsAPIStructure);
type SnapshotDetailsAPIResponse = typeof SnapshotDetailsAPIResponse.infer;

export async function initialize_snapshot_save(server: Server): Promise< number >
{
	if(server.status !== 'running')
	{
		throw new Error('Unable to create a snapshot: Server is not running');
	}

	const snapshot_save_init_response = SnapshotDetailsAPIResponse(await call_hetzner_api(
		`servers/${server.id}/actions/create_image`, 
		'POST', {description: server.name}
	));
	
	if(snapshot_save_init_response instanceof type.errors)
	{
		throw new Error('Unexpected API response when creating a snapshot: ' + snapshot_save_init_response.summary);
	}

	if(snapshot_save_init_response.successful)
	{
		return snapshot_save_init_response.response.image.id;
	}

	throw new Error('Unable to create a snapshot: ' + snapshot_save_init_response.error);
}

export async function get_snapshot(snapshot_id: number): Promise< SnapshotDetails >
{
	const get_snapshot_details = await call_hetzner_api(`images/${snapshot_id}`, 'GET') as SnapshotDetailsAPIResponse;

	if(get_snapshot_details.successful)
	{
		return get_snapshot_details.response.image;
	}

	throw new Error('Unable to get snapshot: ' + get_snapshot_details.error);
}

export async function delete_server(server: Server)
{
	const delete_call = await call_hetzner_api(`servers/${server.id}`, 'DELETE');

	if(delete_call.successful)
	{
		return;
	}

	throw new Error('Unable to stop server: ' + delete_call.error);
}

const SingleServerAPIStructure = type(
	{
		response:
		{
			server: ServerAPIStructure
		}
	}
);
type SingleServerAPIStructure = typeof SingleServerAPIStructure.infer;

const SingleServerAPIResponse = type.and(APIResponse, SingleServerAPIStructure);
type SingleServerAPIResponse = typeof SingleServerAPIResponse.infer;

export async function spin_up_server(image: string | number, name: string | number, server_type: string, location?: string): Promise< NewServerDetails >
{
	const hetzner_config = read_hetzner_config();

	let preferred_location = 'fsn1';
	if(hetzner_config && hetzner_config.preferred_location && hetzner_config.preferred_location !== '')
	{
		preferred_location = hetzner_config.preferred_location;
	}

	let ssh_keys: string[] = [];
	if(hetzner_config && hetzner_config.ssh_keys && hetzner_config.ssh_keys.length > 0)
	{
		ssh_keys = hetzner_config.ssh_keys;
	}

	const server_config = 
	{
		image: image,
		name: name,
		location: preferred_location,
		server_type: server_type,
		ssh_keys: ssh_keys
	};

	if(location)
	{
		server_config.location = location;
	}

	const call = await call_hetzner_api('servers', 'POST', server_config);

	if(call.successful)
	{
		const response = SingleServerAPIResponse(call);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response when spinning up a server: ' + response.summary);
		}

		const new_server_init = response.response.server;
		return {
			id: new_server_init.id, 
			ipv4: new_server_init.public_net.ipv4.ip, 
			ipv6: new_server_init.public_net.ipv6.ip, 
			status: new_server_init.status
		};
	}

	throw new Error('Unable to spin up server: ' + call.error);
}

export async function get_server(server_id: number): Promise<Server>
{
	const get_server_details = await call_hetzner_api(`servers/${server_id}`, 'GET');

	if(get_server_details.successful)
	{
		const server_details = SingleServerAPIResponse(get_server_details);
		if(server_details instanceof type.errors)
		{
			throw new Error('Unexpected API response when getting server details: ' + server_details.summary);
		}

		const server = server_details.response.server;

		return {
			id: server.id, 
			name: server.name, 
			cores: server.server_type.cores, 
			disk: server.server_type.disk, 
			memory: server.server_type.memory, 
			status:server.status, 
			snapshots: []
		};
	}

	throw new Error('Unable to get server: ' + get_server_details.error);
}

export async function delete_snapshot(snapshot_id: number | string): Promise< void >
{
	const delete_snapshot_call = await call_hetzner_api(`images/${snapshot_id}`, 'DELETE');

	if(delete_snapshot_call.successful)
	{
		return;
	}

	throw new Error('Unable to delete snapshot: ' + delete_snapshot_call.error);
}

export async function rebuild_server_from_image(server: Server, snapshot_id: number | string)
{
	if(server.status !== 'running')
	{
		throw new Error(`Server ${server.name} can't be reverted to a previous snapshot as it is inactive`);
	}

	let chosen_snapshot;

	for (let index = 0; index < server.snapshots.length; index++)
	{
		const snapshot = server.snapshots[index];
		
		if(snapshot.id == snapshot_id)
		{
			chosen_snapshot = snapshot;
		}
	}

	if(!chosen_snapshot)
	{
		throw new Error(`Snapshot ID ${snapshot_id} is not available for ${server.name}.`);
	}

	if(chosen_snapshot.disk > server.disk)
	{
		throw new Error(`${server.name} doesn't have enough disk space to fit snapshot ID ${snapshot_id}.`);
	}

	const rebuild_call = await call_hetzner_api(`servers/${server.id}/actions/rebuild`, 'POST', {image: snapshot_id});

	if(rebuild_call.successful)
	{
		return;
	}

	throw new Error('Unable to revert to snapshot: ' + rebuild_call.error);
}

const LocationsAPIStructure = type({
	locations: type({
		name: "string",
		country: "string",
		city: "string"
	}, "[]")
});
type LocationsAPIStructure = typeof LocationsAPIStructure.infer;

export async function get_locations(): Promise<{ location: string; description: string; }[]>
{
	const call = await call_hetzner_api('locations', 'GET');

	if(call.successful)
	{
		const response = LocationsAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for a list of locations: ' + response.summary);
		}

		const locations = [];
		for (const location of response.locations)
		{
			locations.push({location: location.name, description: `${location.city} (${location.country})`});
		}

		return locations;
	}
	else
	{
		throw new Error('Failed to call API to get a list of locations: ' + call.error);
	}
}