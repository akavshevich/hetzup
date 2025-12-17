import readline from 'readline';
import { AxiosError } from "axios";

export function log_error(error: unknown)
{
	if (error instanceof Error)
	{
		console.log("Error: ", error.message);
	} 
	else if (typeof error === 'string')
	{
		console.log("Error: ", error);
	}
	else if (error && typeof error === 'object' && 'statusCode' in error)
	{
		console.log("API error: ", error);
	}
	else 
	{
		console.log("Unknown error: ", error);
	}
}

export function error_to_string(error: unknown): string
{
	if (error instanceof AxiosError)
	{
		return error.status + ': ' + error.message;
	}
	else if (error instanceof Error)
	{
		return error.message;
	}
	else if (typeof error === 'string')
	{
		return error;
	}
	else 
	{
		return 'Unknown error';
	}
}

export function round_to_precision(number: number, precision: number)
{
	const precision_adjustment = Math.pow(10, precision);
	return Math.round(number * precision_adjustment) / precision_adjustment;
}

export function format_date(date_str: string): string
{
	const date = new Date(date_str);

	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const month = months[date.getMonth()];

	const day = date.getDate();
	const year = date.getFullYear();
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');

	return `${month} ${day} ${year}, ${hours}:${minutes}`;
}

export function sleep(ms: number)
{
	return new Promise<void>(
		function (resolve)
		{
			setTimeout(
				function ()
				{
					resolve();
				},
				ms
			);
		}
	);
}

export function clear_prompt()
{
	readline.moveCursor(process.stdout, 0, -1); // Move up 1 line
	readline.clearLine(process.stdout, 0); // Clear the line
}

export function if_null_then_undefined(a: any)
{
	if(a === null)
	{
		return undefined;
	}

	return a;
}