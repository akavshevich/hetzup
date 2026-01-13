import { get_select_response, new_server_confirmation, select_ips, select_server, show_server_actions, show_snapshots } from './lib/interaction';
import { read_hetzner_config, read_server_config, update_hetzner_config, update_server_config } from './lib/configs';
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, delete_server, delete_snapshot, rebuild_server_from_image, get_locations, get_ssh_keys, get_primary_ips, change_ip_auto_delete_status, get_os_images } from './lib/api_calls';

import select, { Separator } from '@inquirer/select';
import chalk from 'chalk';
import readline from 'readline';
import { complete_server_removal, delete_ip, delete_snapshot_visual, determine_preselected_config, generate_server_list, get_available_os_images, load_available_ips, load_available_server_types, revert_to_snapshot, save_server_to_snapshot, spin_up_from_snapshot, stop_server } from './lib/server_actions';
import { main } from './lib/ui_flow';

console.log('');
// main();

// read_server_config();

// update_server_config({servers: [{name: 'abc'}]});
// update_hetzner_config({preferred_location: 'new'});

async function test()
{
	try 
	{

		// const running_servers = await get_running_servers();

		// const servers_to_display = [{name: chalk.red('a'), value: 1}, {name: chalk.green('b'), value: 2}];

		// for (let index = 0; index < running_servers.length; index++)
		// {
		// 	const server = running_servers[index];
		// 	servers_to_display.push({name: chalk.blue(server.name), value: server.id});
		// }

		// const answer = await get_select_response('Available servers: ', servers_to_display);

		// console.log(answer);

		// const images = await get_images();
		// console.log(images);

		// const server_types = await get_available_server_types();
		// console.log(server_types.length);

		// const server_list = await generate_server_list();
		// console.log(server_list);

		// const selected_server = await select_server(server_list);
		// console.log(server_list.get(selected_server.name));

		// const chosen_action = await show_server_actions(selected_server);

		// const snapshot_save_init_response = await initialize_snapshot_save(selected_server);
		// console.log(snapshot_save_init_response);

		// await save_server_to_snapshot(selected_server);
		// await stop_server(selected_server);

		// const new_server = await spin_up_from_snapshot(selected_server, 'cpx11');
		// console.log(new_server);

		// const snapshot = await show_snapshots(selected_server);
		// await delete_snapshot_visual(snapshot);
		// console.log(snapshot, 'deleted');

		// if(!selected_server)
		// {
		// 	return;
		// }

		// const snapshot_id = await show_snapshots(selected_server);

		// await revert_to_snapshot(selected_server, snapshot_id);
		// console.log('Server reverted');

		// await complete_server_removal(selected_server);

		// const locations = await get_locations();
		// const ssh_keys = await get_ssh_keys();
		// console.log(ssh_keys);

		// const available_ips = await load_available_ips('fsn1');
		// const selected_ips = await select_ips(available_ips);
		// console.log(selected_ips);
		
		// for(const ip of available_ips.ipv6)
		// {
		// 	await delete_ip(ip);
		// }

		const available_server_types = await load_available_server_types('fsn1');
		console.log(available_server_types);

		// const preselected_config = await determine_preselected_config(selected_server);
		// await new_server_confirmation(preselected_config);

		// const os_images = await get_available_os_images(100, 'x86');
		// console.log(os_images.raw_os_images);
	}
	catch (error)
	{
		console.log(error);
	}
}

test();


// welcome();