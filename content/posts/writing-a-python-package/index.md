---
title: Writing a python package
date: 2022-07-24T03:22:42.386Z
draft: false
featured: false
image:
  filename: featured
  focal_point: Smart
  preview_only: false
---
A basic python package featuring one module and some data files.

```
proj/
├─ package/
│  ├─ data/
│  │  ├─ __init__.py
│  │  ├─ data_file.csv
│  │  ├─ custom_style.mplstyle
│  ├─ __init__.py
│  ├─ module1.py
├─ MAKEFILE.in
├─ setup.cfg
├─ LICENSE
├─ pyproject.toml
├─ README.md

```

### `MAKEFILE.in`

Tells build tool which non-python files to include in the distribution. Note that the file ends in `.in`, not `.ini`.

Example
```
# MAKEFILE.in
include package/data/*.csv
recursive-include package *.mplstyle
```

### `setup.cfg`

Configuration options for package builder (e.g. `setuptools`, `poetry`, `flit`.)

Example (for `setuptools`)
```
[metadata]
name = package
version = attr: package.__version__
author = John Doe
author_email = john.doe@email.com
description = A description.
long_description = file: README.md
long_description_content_type = text/markdown
url = https://github.com/username/package
classifiers = 
    Programming Language :: Python :: 3
    License :: OSI Approved :: MIT License
    Operating System :: OS Independent

[options]
packages = find:
python_requires = >=3.7
include_package_data = True
```
In this example the version is obtained by importing the package module and reading its `.__version__` attribute which must be defined in the `__init__.py`. In our example it would require something like 
```python
# package/__init__.py
__version__ = "0.0.1"
```

### `LICENSE`
Very important. A good resource is [https://choosealicense.com/](https://choosealicense.com/).

### `pyproject.toml`

Example (for `setuptools`)

```
[build-system]
requires = [
    "setuptools>=54",
    "wheel"
]
build-backend = "setuptools.build_meta"
```

To install the package in development mode (so that you don't have to build the package every time you make a change) you can `cd` to the `proj/` directory and run `python -m pip install -e .`.

To distribute the package by uploading it to the python package index (PyPI), first make sure `build` and `twine` are installed and make a PyPI account. 
```
python -m pip install build twine
```

```
python -m build
```

First test that your package works on testpypi
```
twine upload -r testpypi dist/*
```

Then you can upload it to PyPI with
```
twine upload dist/*
```

 



ASCII file trees were made with [ASCII Tree Generator](https://ascii-tree-generator.com/).