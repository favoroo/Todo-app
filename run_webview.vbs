' run_webview.vbs - Final Robust Version
' This script handles cases where hiding the console causes startup failure.
' It is specifically configured to run "app_copy.py".

' --- Configuration ---
' The full path to your Python 3.11 executable.
Const PYTHON_EXECUTABLE_PATH = "C:\Users\H21078\AppData\Local\Programs\Python\Python311\python.exe"

' --- Script Logic (No need to edit below) ---

' Create a shell object to run commands
Set objShell = WScript.CreateObject("WScript.Shell")

' Get the directory where this V-BScript file is located
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Change the current working directory to the script's path.
objShell.CurrentDirectory = scriptPath

' --- Build the final command ---
' This is the key fix: We use "cmd.exe /c" to run the command.
' This allows us to use shell features like output redirection.
' "> output.log 2>&1" redirects all output (standard and error) to a log file.
' This gives the Python script a place to "print" its startup messages,
' preventing it from crashing when the console window is hidden.

' *** MODIFIED LINE: Changed "app.py" to "app_copy.py" ***
Dim pythonCommand
pythonCommand = """" & PYTHON_EXECUTABLE_PATH & """" & " app_copy.py"

Dim fullShellCommand
fullShellCommand = "cmd.exe /c """ & pythonCommand & " > output.log 2>&1"""

' Run the command:
'   windowStyle: 0 = Hidden
'   waitOnReturn: True = Wait for the app to close.
objShell.Run fullShellCommand, 0, True