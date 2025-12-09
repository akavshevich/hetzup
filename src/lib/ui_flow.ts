import ora from "ora";
import { select_server, show_main_menu, show_server_actions } from "./interaction";
import { generate_server_list } from "./server_actions";
import { Server } from "./types";
import { sleep } from "./utils";

export async function main(navigate_to?: string)
{
	let main_menu_response: string | number | undefined = navigate_to;
	if(!navigate_to)
	{
		main_menu_response = await show_main_menu();
	}

	switch (main_menu_response)
	{
		case 'servers':
			const spinner = ora({text: 'Loading servers...', spinner: 'boxBounce'}).start();
			const server_list = await generate_server_list();
			spinner.stop();

			const selected_server = await select_server(server_list);

			if(!selected_server)
			{
				main();
				break;
			}

			server_actions(selected_server);
			break;

		case 'exit':
			process.exit();

		default:
			console.log('Unknown main menu option');
			break;
	}
}

export async function server_actions(server: Server)
{
	const action = await show_server_actions(server); 

	if(!action)
	{
		main('servers');
		return;
	}

	console.log(action, 'not implemented');
}