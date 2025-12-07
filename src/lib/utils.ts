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