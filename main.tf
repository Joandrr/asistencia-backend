
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# ==========================================
# 1. PROVEEDOR AWS
# ==========================================

provider "aws" {
  region  = "us-east-2"
  profile = "diplo"
}

# ==========================================
# 2. VARIABLES
# ==========================================

variable "my_ip" {
  description = "IP publica autorizada para SSH y API"
  type        = string
  default     = "166.114.163.22/32"
}

# ==========================================
# 3. RED EXISTENTE
# ==========================================

# Buscar VPC predeterminada de Ohio
data "aws_vpc" "default" {
  default = true
}

# Buscar subredes predeterminadas
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# ==========================================
# 4. SISTEMA OPERATIVO
# ==========================================

# Imagen oficial Ubuntu Server 24.04 LTS
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name = "name"
    values = [
      "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"
    ]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ==========================================
# 5. SECURITY GROUP
# ==========================================

resource "aws_security_group" "backend" {
  name_prefix = "asistencia-backend-"
  description = "Firewall NestJS - Diplomado"
  vpc_id      = data.aws_vpc.default.id

  # SSH restringido a tu IP
  ingress {
    description = "SSH personal"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  # API NestJS restringida a tu IP
  ingress {
    description = "NestJS HTTP"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    description     = "NestJS desde EC2 frontend"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = ["sg-081b7722a1664598c"]
  }

  # Salida para npm, actualizaciones y Neon
  egress {
    description = "Salida a Internet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "sg-asistencia-backend"
    Project = "Diplomado"
  }
}

# ==========================================
# 6. INSTANCIA EC2
# ==========================================

resource "aws_instance" "backend" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"

  # Reutilizar subred predeterminada
  subnet_id = sort(data.aws_subnets.default.ids)[0]

  # Acceso SSH e HTTP mediante IP publica
  associate_public_ip_address = true

  # Clave SSH existente en AWS Ohio
  key_name = "lab-2"

  # Firewall
  vpc_security_group_ids = [
    aws_security_group.backend.id
  ]

  # Evitar cargos por creditos CPU Unlimited
  credit_specification {
    cpu_credits = "standard"
  }

  # Instalar Node.js automaticamente
  user_data = <<-EOF
    #!/bin/bash
    set -eux

    apt-get update

    apt-get install -y \
      curl \
      ca-certificates \
      git \
      build-essential

    # Instalar Node.js 22
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs

    # Directorio de NestJS
    mkdir -p /opt/asistencia-backend

    chown ubuntu:ubuntu /opt/asistencia-backend
  EOF

  # Disco de sistema operativo
  root_block_device {
    volume_size           = 10
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  tags = {
    Name    = "ec2-asistencia-backend"
    Project = "Diplomado"
  }
}

# ==========================================
# 7. OUTPUTS
# ==========================================

output "instance_id" {
  description = "Identificador EC2"
  value       = aws_instance.backend.id
}

output "public_ip" {
  description = "IP publica de EC2"
  value       = aws_instance.backend.public_ip
}

output "backend_url" {
  description = "URL del backend NestJS"
  value       = "http://${aws_instance.backend.public_ip}:3000"
}

output "ssh_command" {
  description = "Comando SSH para conectarse"
  value       = "ssh -i ~/.ssh/lab-2.pem ubuntu@${aws_instance.backend.public_ip}"
}
