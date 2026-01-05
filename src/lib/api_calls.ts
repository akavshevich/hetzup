import axios from 'axios';
import { ArkErrors, type } from "arktype";

import { read_hetzner_config } from "./configs";
import { log_error, error_to_string, if_null_then_undefined } from "./utils";
import { NewServerDetails, OSImage, PrimaryIP, Server, ServerType } from "./types";
import { AxiosError } from 'axios';

const APIResponse = type.or({"successful": "true", "response": "object"}, {"successful": "false", "error": "string"});
type APIResponse = typeof APIResponse.infer;

type APIMethod = 'GET' | 'POST' | 'DELETE' | 'PUT';
type APIFields = {[index: string]: any};

export async function call_hetzner_api(path: string, method: APIMethod, fields: APIFields = {}, page: false | number = false): Promise<APIResponse>
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

	if(method === 'POST' || method === 'PUT')
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

type RunningServer = 
{
	id: number, 
	name: string, 
	cores: number, 
	disk: number, 
	memory: number, 
	type: string, 
	ipv4?: string, 
	ipv6?: string,
	location: string
};

const ServerAPIStructure = type(
	{
		id: "number",
		name: "string",
		status: "'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown'",
		server_type:
		{
			name: "string",
			cores: "number",
			disk: "number",
			memory: "number"
		},
		public_net:
		{
			ipv4: type({ip: "string", id: "number"}).or("null"),
			ipv6: type({ip: "string", id: "number"}).or("null"),
		},
		location:
		{
			name: "string"
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
			let ipv4 = undefined;
			let ipv6 = undefined;

			if (server.public_net.ipv4) 
			{
				ipv4 = server.public_net.ipv4.ip;
			}
			if (server.public_net.ipv6)
			{
				ipv6 = server.public_net.ipv6.ip;
			}

			servers.push(
				{
					id: server.id, 
					name: server.name, 
					cores: server.server_type.cores, 
					disk: server.server_type.disk, 
					memory: server.server_type.memory,
					type: server.server_type.name,
					ipv4: ipv4,
					ipv6: ipv6,
					location: server.location.name
				}
			);
		}

		return servers;
	}
	else
	{
		throw new Error('Failed to call API to get a server list: ' + call.error);
	}
}

const SnapshotsAPIStructure = type(
	{
		images: type(
			{
				id: "number", 
				created: "string", 
				created_from: {name: "string"}, 
				image_size: "number | null",
				architecture: "'x86' | 'arm'"
			}, "[]"
		)
	}
);
type SnapshotsAPIStructure = typeof SnapshotsAPIStructure.infer;

export async function get_snapshots(): Promise<{id: number, name: string, date: string, disk: number, architecture: 'x86' | 'arm'}[]>
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
			let image_size = image.image_size;
			if(!image_size)
			{
				image_size = 0;
			}

			snapshots.push({id: image.id, name: image.created_from.name, date: image.created, disk: image_size, architecture: image.architecture});
		}

		return snapshots;
	}
	else
	{
		throw new Error('Failed to call API to get a snapshot list: ' + call.error);
	}
}

const ServerTypesAPIStructure = type(
	{
		server_types: 
		type({
			name: "string", 
			cores: "number", 
			memory: "number",
			disk: "number",
			architecture: "'x86' | 'arm'",
			prices: type({location: "string", price_hourly: {gross: "string"}, price_monthly: {gross: "string"}}, "[]")
		}, "[]")
	}
);
type ServerTypesAPIStructure = typeof ServerTypesAPIStructure.infer;

export async function get_available_server_types(location?: string, architecture?: 'x86' | 'arm'): Promise<ServerType[]>
{
	const call = await call_hetzner_api('server_types', 'GET');

	if(call.successful)
	{
		const response = ServerTypesAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for server type list: ' + response.summary);
		}

		if(!location)
		{
			location = 'fsn1';
			const hetzner_config = read_hetzner_config();

			if(hetzner_config && hetzner_config.preferred_location && hetzner_config.preferred_location !== '')
			{
				location = hetzner_config.preferred_location;
			}
		}

		const server_types = [];
		for (const server_type of response.server_types)
		{
			let hourly_price = 0;
			let monthly_price = 0;

			for (const server_location of server_type.prices)
			{
				if(server_location.location === location)
				{
					hourly_price = +server_location.price_hourly.gross;
					monthly_price = +server_location.price_monthly.gross;
				}
			}

			if(hourly_price === 0 || monthly_price === 0)
			{
				continue;
			}

			if(architecture && server_type.architecture !== architecture)
			{
				continue;
			}

			server_types.push(
				{
					name: server_type.name, 
					cores: server_type.cores, 
					memory: server_type.memory,
					disk: server_type.disk,
					architecture: server_type.architecture,
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
			server: ServerAPIStructure,
			"root_password?": "string | null"
		}
	}
);
type SingleServerAPIStructure = typeof SingleServerAPIStructure.infer;

const SingleServerAPIResponse = type.and(APIResponse, SingleServerAPIStructure);
type SingleServerAPIResponse = typeof SingleServerAPIResponse.infer;

export async function spin_up_server(
						image: string | number, 
						name: string | number, 
						server_type: string, 
						location: string,
						ssh_keys: string[],
						ip_config: { "enable_ipv4": boolean, "enable_ipv6": boolean, "ipv4": null | number, "ipv6": null | number }): 
						Promise< NewServerDetails >
{
	const server_config = 
	{
		image: image,
		name: name,
		location: location,
		server_type: server_type,
		ssh_keys: ssh_keys,
		public_net: ip_config
	};

	const call = await call_hetzner_api('servers', 'POST', server_config);

	if(call.successful)
	{
		const response = SingleServerAPIResponse(call);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response when spinning up a server: ' + response.summary);
		}

		const new_server_init = response.response.server;

		let ipv4 = undefined;
		let ipv6 = undefined;

		if (new_server_init.public_net.ipv4) 
		{
			ipv4 = new_server_init.public_net.ipv4.ip;
		}
		if (new_server_init.public_net.ipv6)
		{
			ipv6 = new_server_init.public_net.ipv6.ip;
		}

		return {
			id: new_server_init.id, 
			ipv4: ipv4, 
			ipv6: ipv6, 
			status: new_server_init.status,
			root_password: if_null_then_undefined(response.response.root_password)
		};
	}

	throw new Error('Unable to spin up server: ' + call.error);
}

export async function get_server(server_id: number)
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

		const server_info = 
		{
			id: server.id,
			name: server.name,
			type: server.server_type.name,
			cores: server.server_type.cores,
			disk: server.server_type.disk,
			memory: server.server_type.memory,
			status: server.status,
			snapshots: [],
			location: server.location.name,
			ips: server.public_net
		};

		return server_info;
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

const LocationsAPIStructure = type(
{
	locations: type(
	{
		name: "string",
		country: "string",
		city: "string"
	}, 
	"[]").atLeastLength(1)
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

const SSHKeysAPIStructure = type(
{
	ssh_keys: type(
	{
		name: "string"
	}, 
	"[]")
});
type SSHKeysAPIStructure = typeof SSHKeysAPIStructure.infer;

export async function get_ssh_keys(): Promise<string[]>
{
	const call = await call_hetzner_api('ssh_keys', 'GET');

	if(call.successful)
	{
		const response = SSHKeysAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for a list of SSH keys: ' + response.summary);
		}

		const ssh_keys = [];
		for(const key of response.ssh_keys)
		{
			ssh_keys.push(key.name);
		}

		return ssh_keys;
	}
	else
	{
		throw new Error('Failed to call API to get SSH keys: ' + call.error);
	}
}


const PrimaryIpsAPIStructure = type(
{
	primary_ips: type(
	{
		ip: "string",
		id: "number",
		name: "string",
		type: "'ipv4' | 'ipv6'",
		assignee_id: "number | null",
		location: {"name": "string"},
		auto_delete: "boolean"
	}, 
	"[]")
});
type PrimaryIpsAPIStructure = typeof PrimaryIpsAPIStructure.infer;

export async function get_primary_ips(): Promise<PrimaryIP[]>
{
	const call = await call_hetzner_api('primary_ips', 'GET');

	if(call.successful)
	{
		const response = PrimaryIpsAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for a list of primary IPs: ' + response.summary);
		}

		const primary_ips: PrimaryIP[] = [];
		for(const ip of response.primary_ips)
		{
			let assigned: number | false = false;
			if(ip.assignee_id)
			{
				assigned = ip.assignee_id;
			}

			primary_ips.push(
				{
					ip: ip.ip,
					id: ip.id,
					name: ip.name,
					type: ip.type,
					assigned: assigned,
					location: ip.location.name,
					auto_delete: ip.auto_delete
				}
			);
		}

		return primary_ips;
	}
	else
	{
		throw new Error('Failed to call API to get primary IPs: ' + call.error);
	}
}

export async function delete_primary_ip(ip_id: number)
{
	const call = await call_hetzner_api(`primary_ips/${ip_id}`, 'DELETE');

	if(call.successful)
	{
		return;
	}

	throw new Error('Unable to delete primary IP: ' + call.error);
}

export async function change_ip_auto_delete_status(ip_id: number, auto_delete: boolean)
{
	const call = await call_hetzner_api(`primary_ips/${ip_id}`, 'PUT', {auto_delete: auto_delete});

	if(call.successful)
	{
		return;
	}

	throw new Error('Unable to change primary IP auto delete status: ' + call.error);
}


const OSImagesListAPIStructure = type(
{
	images: type(OSImage ,"[]")
});
type OSImagesListAPIStructure = typeof OSImagesListAPIStructure.infer;

export async function get_os_images(): Promise< OSImage[] >
{
	const call = await call_hetzner_api('images?type=system&type=app', 'GET');

	if(call.successful)
	{
		const response = OSImagesListAPIStructure(call.response);
		if(response instanceof type.errors)
		{
			throw new Error('Unexpected API response for a list of OS images: ' + response.summary);
		}

		const os_images = [];
		for(const os_image of response.images)
		{
			os_images.push(os_image);
		}

		return os_images;
	}
	else
	{
		throw new Error('Failed to call API to get a list of OS images: ' + call.error);
	}
}