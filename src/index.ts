import { welcome, get_select_response } from './lib/interaction';
import { read_server_list } from './lib/configs';
import { get_running_servers, get_snapshots, get_available_server_types } from './lib/api_calls';

import select, { Separator } from '@inquirer/select';
import chalk from 'chalk';
import readline from 'readline';
import { generate_server_list } from './lib/server_actions';





async function main()
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

		const server_list = await generate_server_list();
		console.log(server_list);
	}
	catch (error)
	{
		console.log(error);
	}

}

main();


// welcome();