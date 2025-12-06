import { read_hetzner_config } from "./configs";
import axios from 'axios';
import { log_error, error_to_string } from "./utils";
import { Server } from "./types";

const hetzner_config = read_hetzner_config();

type APIResponse = {successful: true, response: Object} | {successful: false, error: string};
type APIMethod = 'GET' | 'POST' | 'DELETE';
type APIFields = {[index: string]: any};

async function call_hetzner_api(path: string, method: APIMethod, fields: APIFields = {}, page: false | number = false): Promise<APIResponse>
{
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

type ServersAPIStructure = 
{
	response:
	{
		servers: 
		[
			{
				id: number, 
				name: string,
				status: 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'migrating' | 'rebuilding' | 'unknown',
				server_type:
				{
					cores: number,
					disk: number,
					memory: number
				}
			}
		]
	}
};

type ServersAPIResponse = APIResponse & ServersAPIStructure;

export async function get_running_servers(): Promise<RunningServer[]>
{
	const call = await call_hetzner_api('servers', 'GET') as ServersAPIResponse;
	
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

export async function get_snapshots(): Promise<{id: number, name: string, disk: number}[]>
{
	const call = await call_hetzner_api('images', 'GET', {type: 'snapshot'});

	if(call.successful)
	{
		const response = call.response as {images: {id: number, created: string, created_from: {name: string}, image_size: number}[]};
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

export async function get_available_server_types(): Promise<ServerType[]>
{
	const call = await call_hetzner_api('server_types', 'GET');

	if(call.successful)
	{
		const response = call.response as {
			server_types: 
			{
					name: string, 
					cores: number, 
					memory: number,
					disk: number,
					prices: {location: string, price_hourly: {gross: number}, price_monthly: {gross: number}}[]
			}[]
		};
		
		const server_types = [];

		for (const server_type of response.server_types)
		{
			let hourly_price = 0;
			let monthly_price = 0;

			for (const location of server_type.prices)
			{
				if(location.location === hetzner_config.preferred_location)
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

type SnapshotDetails = 
{
	response: 
	{
		image: 
		{
			id: number,
			status: 'available' | 'creating' | 'unavailable'
		}
	}
};

type SnapshotDetailsAPIResponse = APIResponse & SnapshotDetails;

export async function initialize_snapshot_save(server: Server): Promise< number >
{
	if(server.status !== 'running')
	{
		throw new Error('Unable to create a snapshot: Server is not running');
	}

	const snapshot_save_init_response = await call_hetzner_api(`servers/${server.id}/actions/create_image`, 'POST') as SnapshotDetailsAPIResponse;
	
	if(snapshot_save_init_response.successful)
	{
		return snapshot_save_init_response.response.image.id;
	}

	throw new Error('Unable to create a snapshot: ' + snapshot_save_init_response.error);
}

export async function get_snapshot(snapshot_id: number)
{
	const get_snapshot_details = await call_hetzner_api(`images/${snapshot_id}`, 'GET') as SnapshotDetailsAPIResponse;

	if(get_snapshot_details.successful)
	{
		return get_snapshot_details.response.image;
	}

	throw new Error('Unable to get snapshot: ' + get_snapshot_details.error);
}